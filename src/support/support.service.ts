import {BadRequestException,ConflictException,Injectable,NotFoundException} from "@nestjs/common";
import {and,desc,eq,isNotNull,sql,count,inArray} from "drizzle-orm";
import {db} from "../db/index.js";
import {orders,orderIncidents,supportAudit,orderEvents,users,cleanerProfiles} from "../db/schema.js";
import {supportActions,type SupportAction} from "./support-rules.js";

const listing={id:orderIncidents.id,orderId:orderIncidents.orderId,kind:orderIncidents.kind,reason:orderIncidents.reason,comment:orderIncidents.comment,status:orderIncidents.supportStatus,response:orderIncidents.supportResponse,createdAt:orderIncidents.createdAt,updatedAt:orderIncidents.supportUpdatedAt};
@Injectable()
export class SupportService {
 async mine(actorId:string,page:number){
   const where=and(eq(orderIncidents.actorId,actorId),isNotNull(orderIncidents.supportStatus));
   const items=await db.select(listing).from(orderIncidents).where(where).orderBy(desc(orderIncidents.createdAt),desc(orderIncidents.id)).limit(21).offset((page-1)*20);
   return {items:items.slice(0,20),page,hasMore:items.length>20};
 }
 async queue(status:string,page:number){
   const where=status==="all"?isNotNull(orderIncidents.supportStatus):eq(orderIncidents.supportStatus,status);
   const items=await db.select({...listing,actorRole:orderIncidents.actorRole,assignedTo:orderIncidents.supportAssignedTo,orderStatus:orders.status}).from(orderIncidents).innerJoin(orders,eq(orders.id,orderIncidents.orderId)).where(where).orderBy(desc(orderIncidents.createdAt),desc(orderIncidents.id)).limit(21).offset((page-1)*20);
   return {items:items.slice(0,20),page,hasMore:items.length>20};
 }
 async detail(id:string){
   const [item]=await db.select({...listing,actorRole:orderIncidents.actorRole,assignedTo:orderIncidents.supportAssignedTo,actorId:orderIncidents.actorId,previousStatus:orderIncidents.previousStatus,photos:orderIncidents.photos,orderStatus:orders.status,reviewText:orders.reviewText,rating:orders.rating,reviewVisibility:orders.reviewVisibility}).from(orderIncidents).innerJoin(orders,eq(orders.id,orderIncidents.orderId)).where(and(eq(orderIncidents.id,id),isNotNull(orderIncidents.supportStatus))).limit(1);
   if(!item)throw new NotFoundException("Обращение не найдено");
   const audit=await db.select({id:supportAudit.id,action:supportAudit.action,note:supportAudit.note,createdAt:supportAudit.createdAt}).from(supportAudit).where(eq(supportAudit.incidentId,id)).orderBy(desc(supportAudit.createdAt)).limit(100);
   return {...item,audit};
 }
 async overview(){
   const [u]=await db.select({total:count(),clients:sql<number>`count(*) FILTER (WHERE ${users.role}='client')::int`,cleaners:sql<number>`count(*) FILTER (WHERE ${users.role}='cleaner')::int`}).from(users);
   const [o]=await db.select({total:count(),active:sql<number>`count(*) FILTER (WHERE ${orders.status} IN ('pending','accepted','en_route','arrived','in_progress','pending_confirmation','replacement_pending','disputed'))::int`,completed:sql<number>`count(*) FILTER (WHERE ${orders.status}='completed')::int`}).from(orders);
   const [c]=await db.select({open:sql<number>`count(*) FILTER (WHERE ${orderIncidents.supportStatus}='open')::int`,inReview:sql<number>`count(*) FILTER (WHERE ${orderIncidents.supportStatus}='in_review')::int`,resolved:sql<number>`count(*) FILTER (WHERE ${orderIncidents.supportStatus}='resolved')::int`}).from(orderIncidents);
   return {users:u,orders:o,support:c};
 }
 async ordersPage(page:number){
   const items=await db.select({id:orders.id,status:orders.status,cleaningType:orders.cleaningType,area:orders.area,price:orders.price,createdAt:orders.createdAt}).from(orders).orderBy(desc(orders.createdAt),desc(orders.id)).limit(21).offset((page-1)*20);
   return {items:items.slice(0,20),page,hasMore:items.length>20};
 }
 async usersPage(page:number){
   const items=await db.select({id:users.id,role:users.role,firstName:users.firstName,lastName:users.lastName,verified:sql<boolean>`${users.phoneVerifiedAt} IS NOT NULL`,createdAt:users.createdAt,isAvailable:cleanerProfiles.isAvailable}).from(users).leftJoin(cleanerProfiles,eq(cleanerProfiles.userId,users.id)).orderBy(desc(users.createdAt),desc(users.id)).limit(21).offset((page-1)*20);
   return {items:items.slice(0,20),page,hasMore:items.length>20};
 }
 async act(id:string,actorId:string,action:SupportAction,note:string){
   if(!supportActions.includes(action)||typeof note!=="string"||note.length>1500|| (action!=="claim"&&!note.trim()))throw new BadRequestException("Укажите решение или комментарий");
   const response=note.trim()||null;
   await db.transaction(async tx=>{
     const [incident]=await tx.select().from(orderIncidents).where(and(eq(orderIncidents.id,id),isNotNull(orderIncidents.supportStatus))).for("update");
     if(!incident)throw new NotFoundException("Обращение не найдено");
     if(incident.supportStatus==="resolved")throw new ConflictException("Обращение уже закрыто");
     if(incident.supportAssignedTo&&incident.supportAssignedTo!==actorId)throw new ConflictException("Обращение уже назначено другому сотруднику");
     // Serialize resuming an assignment with the normal cleaner acceptance path.
     if(action==="resume_disputed"&&incident.cleanerId){await tx.select({id:cleanerProfiles.userId}).from(cleanerProfiles).where(eq(cleanerProfiles.userId,incident.cleanerId)).for("update");}
     const [order]=await tx.select().from(orders).where(eq(orders.id,incident.orderId)).for("update");
     if(!order)throw new NotFoundException("Заказ не найден");
     const now=new Date();
     let resolved=false;
     if(action==="hide_review"||action==="publish_review"){
       if(incident.kind!=="review_report"||order.rating==null||order.status!=="completed")throw new ConflictException("Нет отзыва для модерации");
       await tx.update(orders).set({reviewVisibility:action==="hide_review"?"hidden":"published"}).where(eq(orders.id,order.id));
       resolved=true;
     }else if(action==="cancel_disputed"||action==="resume_disputed"){
       if(order.status!=="disputed"||incident.kind==="review_report")throw new ConflictException("Заказ уже не в споре");
       if(action==="resume_disputed"){
         if(!order.cleanerId||order.cleanerId!==incident.cleanerId||!["accepted","en_route","arrived","in_progress","pending_confirmation"].includes(incident.previousStatus))throw new ConflictException("Нельзя возобновить этот заказ");
         const [other]=await tx.select({id:orders.id}).from(orders).where(and(eq(orders.cleanerId,order.cleanerId),inArray(orders.status,["accepted","en_route","arrived","in_progress"]),sql`${orders.id} <> ${order.id}`)).limit(1);
         if(other&&incident.previousStatus!=="pending_confirmation")throw new ConflictException("У клинера есть другой активный заказ");
       }
       await tx.update(orders).set({status:action==="cancel_disputed"?"cancelled":incident.previousStatus,...(action==="resume_disputed"?{completionIssueAt:null}:{})}).where(eq(orders.id,order.id));
       await tx.insert(orderEvents).values({orderId:order.id,actorId,eventType:action==="cancel_disputed"?"order_cancelled":"support_order_resumed"});
       resolved=true;
     }else if(action==="resolve"){
       if(order.status==="disputed"&&incident.kind!=="review_report")throw new ConflictException("Сначала выберите решение по спорному заказу");
       resolved=true;
     }
     await tx.update(orderIncidents).set({supportStatus:resolved?"resolved":"in_review",supportAssignedTo:actorId,supportUpdatedAt:now,...(response?{supportResponse:response}:{}),...(resolved?{supportResolvedAt:now}:{})}).where(eq(orderIncidents.id,id));
     await tx.insert(supportAudit).values({incidentId:id,actorId,action,note:response});
     await tx.insert(orderEvents).values({orderId:order.id,actorId,eventType:resolved?"support_case_resolved":"support_case_updated"});
   });
   return this.detail(id);
 }
}
