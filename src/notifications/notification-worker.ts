import {Injectable,Logger,OnModuleInit,OnModuleDestroy} from "@nestjs/common";
import {pool} from "../db/index.js";
import {MAX_ATTEMPTS,retryDelayMs,isPermanentFailure} from "./outbox-rules.js";
type Job={id:string;recipient_id:string;message:string;attempts:number;lease_token:string;offer_id:string|null;offer_round:number|null;expires_at:Date|null};
@Injectable()
export class NotificationWorker implements OnModuleInit,OnModuleDestroy{
 private readonly logger=new Logger(NotificationWorker.name);
 private timer?:ReturnType<typeof setInterval>;
 private running=false;
 onModuleInit(){this.timer=setInterval(()=>void this.tick(),3000);this.timer.unref?.();void this.tick();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async tick(){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token||this.running)return;
  this.running=true;
  try{
   await pool.query("UPDATE notification_outbox SET status='expired',lease_until=NULL,lease_token=NULL WHERE expires_at<=now() AND (status='pending' OR (status='sending' AND lease_until<=now()))");
   await pool.query("UPDATE notification_outbox SET status='failed',lease_until=NULL,lease_token=NULL,last_error='attempt limit reached' WHERE attempts >= $1 AND (status='pending' OR (status='sending' AND lease_until<=now()))",[MAX_ATTEMPTS]);
   for(let i=0;i<10;i++){
    const {rows}=await pool.query<Job>(`WITH candidate AS (SELECT id FROM notification_outbox WHERE attempts<$1 AND (expires_at IS NULL OR expires_at>now()) AND ((status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<=now())) ORDER BY next_attempt_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE notification_outbox n SET status='sending',attempts=n.attempts+1,lease_until=now()+interval '60 seconds',lease_token=gen_random_uuid() FROM candidate WHERE n.id=candidate.id RETURNING n.id,n.recipient_id,n.message,n.attempts,n.lease_token,n.offer_id,n.offer_round,n.expires_at`,[MAX_ATTEMPTS]);
    if(!rows.length)break;await this.deliver(rows[0],token);
   }
  }catch{this.logger.warn("Notification outbox unavailable; retry on next tick");}
  finally{this.running=false;}
 }
 private async finish(job:Job,status:string,error:string|null=null,delay=0){
  await pool.query(`UPDATE notification_outbox SET status=$3,last_error=$4,lease_until=NULL,lease_token=NULL,next_attempt_at=now()+($5::bigint*interval '1 millisecond'),sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END WHERE id=$1 AND lease_token=$2 AND status='sending'`,[job.id,job.lease_token,status,error,delay]);
 }
 private async deliver(job:Job,token:string){
  if(job.expires_at&&job.expires_at.getTime()<=Date.now()){await this.finish(job,"expired");return;}
  if(job.offer_id){
   const {rowCount}=await pool.query(`SELECT 1 FROM order_offers f JOIN orders o ON o.id=f.order_id WHERE f.id=$1 AND f.batch_number=$2 AND f.cleaner_id=$3 AND f.status='offered' AND f.expires_at>now() AND o.status='pending' AND o.cleaner_id IS NULL`,[job.offer_id,job.offer_round,job.recipient_id]);
   if(!rowCount){await this.finish(job,"expired");return;}
  }
  const {rows}=await pool.query<{telegram_id:string|null}>("SELECT telegram_id::text AS telegram_id FROM users WHERE id=$1",[job.recipient_id]);
  if(!rows[0]?.telegram_id){await this.finish(job,"failed","recipient has no telegram id");return;}
  try{
   const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:rows[0].telegram_id,text:job.message,reply_markup:{inline_keyboard:[[{text:"Открыть CleanGo",web_app:{url:"https://clean-go-frontend.vercel.app"}}]]}}),signal:AbortSignal.timeout(8000)});
   const body=await response.json().catch(()=>null) as {ok?:boolean;parameters?:{retry_after?:number}}|null;
   if(response.ok&&body?.ok){await this.finish(job,"sent");return;}
   const failed=isPermanentFailure(response.status)||job.attempts>=MAX_ATTEMPTS;
   const retryAfter=Number(body?.parameters?.retry_after??0);
   await this.finish(job,failed?"failed":"pending","telegram HTTP "+response.status,retryDelayMs(job.attempts,Number.isFinite(retryAfter)?retryAfter:0));
  }catch{
   await this.finish(job,job.attempts>=MAX_ATTEMPTS?"failed":"pending","network or timeout",retryDelayMs(job.attempts));
  }
 }
}
