import {and,desc,eq,isNotNull,sql} from "drizzle-orm";
import {db} from "../db/index.js";
import {orders} from "../db/schema.js";

export async function reputationSummary(cleanerId:string){
 const [row]=await db.select({
  completedOrders:sql<number>`count(*)::int`,
  reviewCount:sql<number>`count(*) FILTER (WHERE ${orders.reviewVisibility}='published' AND ${orders.rating} IS NOT NULL)::int`,
  rating:sql<string|null>`avg(${orders.rating}) FILTER (WHERE ${orders.reviewVisibility}='published')`,
 }).from(orders).where(and(eq(orders.cleanerId,cleanerId),eq(orders.status,"completed")));
 return {completedOrders:row?.completedOrders??0,reviewCount:row?.reviewCount??0,rating:row?.rating==null?null:Number(Number(row.rating).toFixed(2))};
}
export async function publicReputation(cleanerId:string){
 const summary=await reputationSummary(cleanerId);
 const reviews=await db.select({rating:orders.rating,reviewText:orders.reviewText,reviewedAt:orders.reviewedAt})
 .from(orders).where(and(eq(orders.cleanerId,cleanerId),eq(orders.status,"completed"),eq(orders.reviewVisibility,"published"),isNotNull(orders.rating),isNotNull(orders.reviewText)))
 .orderBy(desc(orders.reviewedAt),desc(orders.id)).limit(20);
 return {...summary,reviews};
}
