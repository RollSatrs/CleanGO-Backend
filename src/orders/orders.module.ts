
import { Module } from "@nestjs/common";

import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [
    PricingModule,
    AuthModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
