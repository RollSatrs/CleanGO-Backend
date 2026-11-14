
import { Injectable } from "@nestjs/common";
import { eq, desc } from "drizzle-orm";

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

  async findByUserId(userId: string) {
    return db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));
  }
}
