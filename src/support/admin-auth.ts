import {CanActivate,ExecutionContext,Injectable,UnauthorizedException,ForbiddenException,ServiceUnavailableException,HttpException,HttpStatus} from "@nestjs/common";
import {createHash,randomBytes,randomInt,timingSafeEqual} from "node:crypto";
import type {Request} from "express";
import {eq} from "drizzle-orm";
import {db} from "../db/index.js";
import {users} from "../db/schema.js";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const equal=(a:string,b:string)=>timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
const denied=()=>new UnauthorizedException("Неверный ключ или код");
type Owner={id:string;name:string;telegramId:bigint};
type Challenge={ownerId:string;codeHash:string;expires:number;attempts:number};
type Session={ownerId:string;expires:number;keyHash:string};
export type AdminRequest=Request&{admin:Owner;adminToken:string};
@Injectable()
export class AdminAuthService {
 private challenges=new Map<string,Challenge>();
 private sessions=new Map<string,Session>();
 private attempts:number[]=[];
 private lastSend=0;
 private key(){
   const key=process.env.CLEANGO_ADMIN_ACCESS_KEY??"";
   if(!/^[a-f0-9]{64}$/i.test(key))throw new ServiceUnavailableException("Вход администратора ещё не настроен");
   return key;
 }
 private async owner():Promise<Owner>{
   const ids=(process.env.CLEANGO_ADMIN_USER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean);
   if(ids.length!==1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(ids[0]))throw new ServiceUnavailableException("Настройте один аккаунт владельца");
   const [u]=await db.select({id:users.id,firstName:users.firstName,lastName:users.lastName,telegramId:users.telegramId,verified:users.phoneVerifiedAt}).from(users).where(eq(users.id,ids[0])).limit(1);
   if(!u?.verified||!u.telegramId)throw new ForbiddenException("Аккаунт владельца не подтверждён");
   return {id:u.id,name:[u.firstName,u.lastName].filter(Boolean).join(" ")||"Владелец",telegramId:u.telegramId};
 }
 private prune(now:number){
   for(const [k,v] of this.challenges)if(v.expires<=now)this.challenges.delete(k);
   for(const [k,v] of this.sessions)if(v.expires<=now)this.sessions.delete(k);
 }
 async start(key:unknown){
   const expected=this.key(),now=Date.now();this.prune(now);
   this.attempts=this.attempts.filter(t=>t>now-300000);
   if(this.attempts.length>=5)throw new HttpException("Слишком много попыток. Повторите позже.",HttpStatus.TOO_MANY_REQUESTS);
   this.attempts.push(now);
   if(typeof key!=="string"||key.length!==64||!equal(key,expected))throw denied();
   if(now-this.lastSend<60000)throw new HttpException("Повторный код доступен через минуту",HttpStatus.TOO_MANY_REQUESTS);
   this.lastSend=now;
   const owner=await this.owner(),bot=process.env.TELEGRAM_BOT_TOKEN;
   if(!bot)throw new ServiceUnavailableException("Telegram не настроен");
   const challengeId=randomBytes(32).toString("hex"),code=String(randomInt(100000,1000000));
   this.challenges.clear();
   this.challenges.set(challengeId,{ownerId:owner.id,codeHash:digest(code+challengeId),expires:now+300000,attempts:0});
   try{
     const response=await fetch("https://api.telegram.org/bot"+bot+"/sendMessage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:owner.telegramId.toString(),text:"CleanGo Admin: код входа "+code+". Действует 5 минут. Никому не передавайте код."}),signal:AbortSignal.timeout(10000)});
     const result=await response.json() as {ok?:boolean};
     if(!response.ok||!result.ok)throw Error("delivery");
   }catch{this.challenges.delete(challengeId);throw new ServiceUnavailableException("Не удалось отправить код. Откройте чат с ботом и повторите позже.");}
   return {challengeId};
 }
 async verify(challengeId:unknown,code:unknown){
   const key=this.key(),now=Date.now();this.prune(now);
   if(typeof challengeId!=="string"||typeof code!=="string"||!/^\d{6}$/.test(code))throw denied();
   const c=this.challenges.get(challengeId);
   if(!c)throw denied();
   c.attempts++;
   if(!equal(c.codeHash,digest(code+challengeId))){if(c.attempts>=5)this.challenges.delete(challengeId);throw denied();}
   this.challenges.delete(challengeId);
   const owner=await this.owner();
   if(owner.id!==c.ownerId)throw denied();
   if(this.sessions.size>=10)throw new HttpException("Слишком много сессий. Выйдите из другой сессии.",HttpStatus.TOO_MANY_REQUESTS);
   const token=randomBytes(32).toString("hex");
   this.sessions.set(digest(token),{ownerId:owner.id,expires:now+7200000,keyHash:digest(key)});
   return {token,expiresIn:7200};
 }
 async authenticate(token:string){
   const now=Date.now();this.prune(now);
   const s=this.sessions.get(digest(token));
   if(!s||s.keyHash!==digest(this.key()))throw new UnauthorizedException("Войдите в CleanGo Admin");
   const owner=await this.owner();
   if(owner.id!==s.ownerId)throw new UnauthorizedException("Сессия недействительна");
   return owner;
 }
 logout(token:string){this.sessions.delete(digest(token));}
}
@Injectable()
export class AdminGuard implements CanActivate{
 constructor(private readonly auth:AdminAuthService){}
 async canActivate(context:ExecutionContext){
   const req=context.switchToHttp().getRequest<AdminRequest>();
   const m=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization??"");
   if(!m)throw new UnauthorizedException("Войдите в CleanGo Admin");
   req.admin=await this.auth.authenticate(m[1]);req.adminToken=m[1];return true;
 }
}
