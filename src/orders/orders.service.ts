
import { Injectable } from "@nestjs/common";

import { db } from "../db/index.js";
import { orders } from "../db/schema.js";

import { PricingService } from "../pricing/pricing.service.js";

import { CreateOrderDto } from "./dto/create-order.dto.js";

@Injectable()
export class OrdersService {
  constructor(
    private readonly pricingService: PricingService,
  ) {}

  async create(orderData: CreateOrderDto) {
    // 1. Рассчитываем стоимость уборки
    const quote = this.pricingService.calculate(
      orderData.cleaningType,
      orderData.area,
    );

    // 2. Сохраняем заказ вместе со стоимостью
    const [order] = await db
      .insert(orders)
      .values({
        address: orderData.address,
        area: orderData.area,
        cleaningType: orderData.cleaningType,
        price: quote.totalPrice,
        status: "pending",
      })
      .returning();

    // 3. Возвращаем созданный заказ
    return order;
  }

  async findAll() {
    return db.select().from(orders);
  }
}
