
import { Module } from "@nestjs/common";

import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";

import { NotificationWorker } from "./notifications/notification-worker.js";
import { SupportModule } from "./support/support.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { OrdersModule } from "./orders/orders.module.js";
import { PricingModule } from "./pricing/pricing.module.js";

@Module({
  imports: [
    AuthModule,
    SupportModule,
    OrdersModule,
    PricingModule,
  ],
  controllers: [AppController],
  providers: [AppService, NotificationWorker],
})
export class AppModule {}
