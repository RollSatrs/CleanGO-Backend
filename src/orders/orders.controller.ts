
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";

import type { Request } from "express";

import { OrdersService } from "./orders.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";

import {
  AuthGuard,
  type AuthenticatedRequest,
} from "../auth/auth.guard.js";

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  @Post()
  async create(
    @Body() orderData: CreateOrderDto,
    @Req() request: Request,
  ) {
    const user = (
      request as AuthenticatedRequest
    ).user;

    if (user.role !== "client" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Для заказа требуется подтверждённый номер клиента");
    }

    return this.ordersService.create(
      user.id,
      orderData,
    );
  }

  @Patch(":id/accept")
  async accept(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Для принятия заказа нужен подтверждённый профиль клинера");
    }
    return this.ordersService.accept(id, user.id);
  }

  @Get()
  async findMine(
    @Req() request: Request,
  ) {
    const user = (
      request as AuthenticatedRequest
    ).user;

    return this.ordersService.findByUserId(
      user.id,
    );
  }
}
