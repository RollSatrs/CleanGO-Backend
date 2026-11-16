
import { Injectable, ConflictException } from "@nestjs/common";
import { eq, desc, and, isNull, gt, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { orders, orderOffers, orderEvents } from "../db/schema.js";

import { PricingService } from "../pricing/pricing.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";

@Injectable()
export class OrdersService {
  constructor(
    private readonly pricingService: PricingService,
  ) {}

  async create(
    userId: string,
    orderData: CreateOrderDto,
  ) {
    const quote = this.pricingService.calculate(
      orderData.cleaningType,
      orderData.area,
    );

    const [order] = await db
      .insert(orders)
      .values({
        userId,
        address: orderData.address,
        area: orderData.area,
        cleaningType: orderData.cleaningType,
        price: quote.totalPrice,
        status: "pending",
      })
      .returning();

    return order;
  }

  /**
   * Only a currently offered, unexpired private proposal may accept.
   * The conditional order UPDATE serializes competing acceptances in PostgreSQL.
   * All offer changes and audit records commit in the same transaction.
   */
  async accept(orderId: string, cleanerId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [accepted] = await tx.update(orders)
        .set({ cleanerId, acceptedAt: now, status: "accepted" })
        .where(and(
          eq(orders.id, orderId),
          eq(orders.status, "pending"),
          isNull(orders.cleanerId),
          sql`EXISTS (
            SELECT 1 FROM order_offers AS offer
            WHERE offer.order_id = ${orders.id}
              AND offer.cleaner_id = ${cleanerId}
              AND offer.status = 'offered'
              AND offer.expires_at > ${now}
          )`,
        ))
        .returning();

      if (!accepted) {
        throw new ConflictException("Предложение истекло, отозвано или заказ недоступен");
      }

      await tx.update(orderOffers)
        .set({ status: "accepted", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.cleanerId, cleanerId),
          eq(orderOffers.status, "offered"),
          gt(orderOffers.expiresAt, now),
        ));

      await tx.update(orderOffers)
        .set({ status: "revoked", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.status, "offered"),
        ));

      await tx.insert(orderEvents).values({
        orderId,
        actorId: cleanerId,
        eventType: "order_accepted",
      });

      return accepted;
    });
  }

  /** A cleaner may decline only their own active private offer. */
  async decline(orderId: string, cleanerId: string) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [declined] = await tx.update(orderOffers)
        .set({ status: "declined", respondedAt: now })
        .where(and(
          eq(orderOffers.orderId, orderId),
          eq(orderOffers.cleanerId, cleanerId),
          eq(orderOffers.status, "offered"),
          gt(orderOffers.expiresAt, now),
          sql`EXISTS (
            SELECT 1 FROM orders AS o
            WHERE o.id = ${orderOffers.orderId}
              AND o.status = 'pending'
              AND o.cleaner_id IS NULL
          )`,
        ))
        .returning({ id: orderOffers.id });

      if (!declined) {
        throw new ConflictException("Активное предложение не найдено");
      }
      await tx.insert(orderEvents).values({
        orderId,
        actorId: cleanerId,
        eventType: "offer_declined",
      });
      return { declined: true };
    });
  }

  async findByUserId(userId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }
}
