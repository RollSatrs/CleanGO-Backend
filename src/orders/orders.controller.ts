
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
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

    return this.ordersService.create(
      user.id,
      orderData,
    );
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
