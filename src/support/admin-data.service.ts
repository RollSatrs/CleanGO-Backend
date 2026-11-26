import {Injectable,NotFoundException} from "@nestjs/common";
import {and,desc,eq,or,sql,count,isNotNull} from "drizzle-orm";
import {db} from "../db/index.js";
import {orders,users,cleanerProfiles,orderIncidents,orderEvents} from "../db/schema.js";
const orderFields={id:orders.id,userId:orders.userId,cleanerId:orders.cleanerId,status:orders.status,cleaningType:orders.cleaningType,area:orders.area,price:orders.price,createdAt:orders.createdAt,rating:orders.rating,reviewVisibility:orders.reviewVisibility};
@Injectable()
export class AdminDataService{
 async ordersPage(page:number,status?:string,q?:string,userId?:string){
   const search=q?.trim().slice(0,100);
   const where=and(status?eq(orders.status,status):undefined,userId?or(eq(orders.userId,userId),eq(orders.cleanerId,userId)):undefined,search?sql`${orders.id}::text ILIKE ${"%"+search+"%"}`:undefined);
   const rows=await db.select(orderFields).from(orders).where(where).orderBy(desc(orders.createdAt),desc(orders.id)).limit(21).offset((page-1)*20);
   return {items:rows.slice(0,20),hasMore:rows.length>20};
 }
 async usersPage(page:number,role?:string,q?:string){
   const search=q?.trim().slice(0,100);
   const where=and(role?eq(users.role,role):undefined,search?sql`concat_ws(' ',${users.firstName},${users.lastName},${users.id}::text) ILIKE ${"%"+search+"%"}`:undefined);
   const rows=await db.select({id:users.id,role:users.role,firstName:users.firstName,lastName:users.lastName,verified:sql<boolean>`${users.phoneVerifiedAt} IS NOT NULL`,createdAt:users.createdAt,isAvailable:cleanerProfiles.isAvailable,availableUntil:cleanerProfiles.availableUntil}).from(users).leftJoin(cleanerProfiles,eq(cleanerProfiles.userId,users.id)).where(where).orderBy(desc(users.createdAt),desc(users.id)).limit(21).offset((page-1)*20);
   return {items:rows.slice(0,20),hasMore:rows.length>20};
 }
 async user(id:string){
   const [u]=await db.select({id:users.id,role:users.role,firstName:users.firstName,lastName:users.lastName,verified:sql<boolean>`${users.phoneVerifiedAt} IS NOT NULL`,createdAt:users.createdAt,isAvailable:cleanerProfiles.isAvailable,availableUntil:cleanerProfiles.availableUntil,serviceTypes:cleanerProfiles.serviceTypes,serviceRadiusKm:cleanerProfiles.serviceRadiusKm}).from(users).leftJoin(cleanerProfiles,eq(cleanerProfiles.userId,users.id)).where(eq(users.id,id)).limit(1);
   if(!u)throw new NotFoundException("Пользователь не найден");
   const where=or(eq(orders.userId,id),eq(orders.cleanerId,id));
   const stats=await db.select({status:orders.status,count:count()}).from(orders).where(where).groupBy(orders.status);
   const recent=await this.ordersPage(1,undefined,undefined,id);
   const cases=await db.select({id:orderIncidents.id,orderId:orderIncidents.orderId,kind:orderIncidents.kind,status:orderIncidents.supportStatus,createdAt:orderIncidents.createdAt}).from(orderIncidents).where(and(eq(orderIncidents.actorId,id),isNotNull(orderIncidents.supportStatus))).orderBy(desc(orderIncidents.createdAt)).limit(20);
   return {user:u,stats,orders:recent,cases};
 }
 async order(id:string){
   const [o]=await db.select({...orderFields,completionSubmittedAt:orders.completionSubmittedAt,clientConfirmedAt:orders.clientConfirmedAt,inspectionMethod:orders.inspectionMethod,reviewText:orders.reviewText}).from(orders).where(eq(orders.id,id)).limit(1);
   if(!o)throw new NotFoundException("Заказ не найден");
   const events=await db.select({id:orderEvents.id,eventType:orderEvents.eventType,createdAt:orderEvents.createdAt}).from(orderEvents).where(eq(orderEvents.orderId,id)).orderBy(desc(orderEvents.createdAt)).limit(100);
   const cases=await db.select({id:orderIncidents.id,kind:orderIncidents.kind,reason:orderIncidents.reason,status:orderIncidents.supportStatus,createdAt:orderIncidents.createdAt}).from(orderIncidents).where(eq(orderIncidents.orderId,id)).orderBy(desc(orderIncidents.createdAt)).limit(30);
   return {order:o,events,cases};
 }
 async reviews(page:number){
   const rows=await db.select({...orderFields,reviewText:orders.reviewText,reviewedAt:orders.reviewedAt}).from(orders).where(isNotNull(orders.rating)).orderBy(desc(orders.reviewedAt),desc(orders.id)).limit(21).offset((page-1)*20);
   return {items:rows.slice(0,20),hasMore:rows.length>20};
 }
 async dashboard(){
   const [daily,services,statuses,rating,latest]=await Promise.all([
     db.execute(sql`SELECT to_char(d,'YYYY-MM-DD') AS day, count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status='completed')::int AS completed FROM generate_series((now() AT TIME ZONE 'Asia/Almaty')::date-13,(now() AT TIME ZONE 'Asia/Almaty')::date,interval '1 day') d LEFT JOIN orders o ON (o.created_at AT TIME ZONE 'Asia/Almaty')::date=d::date GROUP BY d ORDER BY d`),
     db.select({type:orders.cleaningType,count:count()}).from(orders).groupBy(orders.cleaningType),
     db.select({status:orders.status,count:count()}).from(orders).groupBy(orders.status),
     db.execute(sql`SELECT round(avg(rating),2)::float AS average,count(rating)::int AS count FROM orders WHERE status='completed' AND review_visibility='published'`),
     this.ordersPage(1)
   ]);
   return {daily:daily.rows,services,statuses,rating:rating.rows[0],latest:latest.items.slice(0,8)};
 }
}
