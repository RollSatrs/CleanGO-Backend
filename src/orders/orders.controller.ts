
import {
  Body,
  Controller,
  Get,
  Param,
  Query,
  Patch,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";

import type { Request } from "express";
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Max, Min, ArrayNotEmpty, ArrayUnique } from "class-validator";

import { OrdersService } from "./orders.service.js";
import { CreateOrderDto } from "./dto/create-order.dto.js";

import {
  AuthGuard,
  type AuthenticatedRequest,
} from "../auth/auth.guard.js";

class CleanerProfileDto {
  @IsBoolean()
  isAvailable!: boolean;

  @IsInt()
  @Min(1)
  @Max(30)
  serviceRadiusKm!: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(["regular", "general", "renovation"], { each: true })
  serviceTypes!: string[];

  @IsOptional()
  @IsIn([1, 2, 4])
  availabilityHours?: 1 | 2 | 4;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  @Get("cleaner/profile")
  async getCleanerProfile(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.getCleanerProfile(user.id);
  }

  @Patch("cleaner/profile")
  async updateCleanerProfile(@Req() request: Request, @Body() body: CleanerProfileDto) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    if ((body.latitude == null) !== (body.longitude == null)) {
      throw new BadRequestException("Координаты нужно передавать вместе");
    }
    if (body.availabilityHours != null && ![1, 2, 4].includes(body.availabilityHours)) {
      throw new BadRequestException("Доступность можно включить на 1, 2 или 4 часа");
    }
    return this.ordersService.updateCleanerProfile(user.id, body);
  }

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

  @Patch(":id/cancel")
  async cancelByClient(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "client" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Отмена доступна только подтверждённому клиенту");
    }
    return this.ordersService.cancelByClient(id, user.id);
  }

  @Get("history")
  async history(
    @Req() request: Request,
    @Query("section") section = "active",
    @Query("page") pageValue = "1",
  ) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "client" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("История доступна подтверждённому клиенту");
    }
    if (!["active", "archive"].includes(section) || !/^[1-9]\d*$/.test(pageValue)) {
      throw new BadRequestException("Некорректные параметры истории");
    }
    const page = Number(pageValue);
    if (!Number.isSafeInteger(page) || page > 100000) {
      throw new BadRequestException("Некорректный номер страницы");
    }
    return this.ordersService.findMinePage(user.id, section as "active" | "archive", page);
  }

  @Get(":id")
  async findOneForClient(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "client" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Заказ доступен подтверждённому клиенту");
    }
    const order = await this.ordersService.findOneForClient(id, user.id);
    if (!order) throw new NotFoundException("Заказ не найден");
    return order;
  }

  @Get(":id/progress")
  async matchingProgress(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "client" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клиента");
    }
    const progress = await this.ordersService.getMatchingProgress(id, user.id);
    if (!progress) throw new NotFoundException("Заказ не найден");
    return progress;
  }

  @Get("cleaner/jobs")
  async findCleanerJobs(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.findCleanerJobs(user.id);
  }

  @Patch(":id/en-route")
  async markEnRoute(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) throw new ForbiddenException("Требуется подтверждённый клинер");
    return this.ordersService.markEnRoute(id, user.id);
  }

  @Patch(":id/arrived")
  async markArrived(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) throw new ForbiddenException("Требуется подтверждённый клинер");
    return this.ordersService.markArrived(id, user.id);
  }

  @Patch(":id/start")
  async startCleaning(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.startCleaning(id, user.id);
  }

  @Patch(":id/complete")
  async completeCleaning(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.completeCleaning(id, user.id);
  }

  @Get("offers/mine")
  async findMyOffers(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Предложения доступны только подтверждённым клинерам");
    }
    return this.ordersService.findActiveOffers(user.id);
  }

  @Patch(":id/accept")
  async accept(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Для принятия заказа нужен подтверждённый профиль клинера");
    }
    return this.ordersService.accept(id, user.id);
  }

  @Patch(":id/decline")
  async decline(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Для отклонения предложения нужен подтверждённый профиль клинера");
    }
    return this.ordersService.decline(id, user.id);
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
