
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

  @Get("cleaner/jobs")
  async findCleanerJobs(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.findCleanerJobs(user.id);
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

  @Get("cleaner/jobs")
  async findCleanerJobs(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Доступно только подтверждённым клинерам");
    }
    return this.ordersService.findCleanerJobs(user.id);
  }

  @Patch(":id/start")
  async startJob(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Доступно только подтверждённым клинерам");
    }
    return this.ordersService.transitionCleanerJob(id, user.id, "start");
  }

  @Patch(":id/complete")
  async completeJob(@Param("id") id: string, @Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Доступно только подтверждённым клинерам");
    }
    return this.ordersService.transitionCleanerJob(id, user.id, "complete");
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
