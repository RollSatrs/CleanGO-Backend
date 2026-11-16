
import { Injectable, ConflictException } from "@nestjs/common";
import { eq, desc, and, isNull } from "drizzle-orm";

import { db } from "../db/index.js";
import { orders } from "../db/schema.js";

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

  // Conditional UPDATE is atomic under PostgreSQL concurrency: first acceptance wins.
  async accept(orderId: string, cleanerId: string) {
    const [accepted] = await db.update(orders)
      .set({ cleanerId, acceptedAt: new Date(), status: "accepted" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending"), isNull(orders.cleanerId)))
      .returning();
    if (!accepted) throw new ConflictException("Заказ уже принят или недоступен");
    return accepted;
  }

  async findByUserId(userId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }
}
