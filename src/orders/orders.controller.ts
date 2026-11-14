
import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';

import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  @Post()
  async create(@Body() orderData: CreateOrderDto) {
    return this.ordersService.create(orderData);
  }

  @Get()
  async findAll() {
    return this.ordersService.findAll();
  }
}
