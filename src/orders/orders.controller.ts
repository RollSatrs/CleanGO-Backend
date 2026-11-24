
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsISO8601, IsString, IsUUID, MaxLength, ArrayMaxSize, Max, Min, ArrayNotEmpty, ArrayUnique } from "class-validator";

import { exceptionActions, exceptionReasons, type ExceptionAction } from "./order-exceptions.js";
import { clientHistorySections, type ClientHistorySection } from "./order-history.js";
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

class CleanerPreferencesDto {
  @IsInt() @Min(1) @Max(30) serviceRadiusKm!:number;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(["regular","general","renovation"],{each:true}) serviceTypes!:string[];
}
class CleanerLocationDto {
  @IsNumber() @Min(-90) @Max(90) latitude!:number;
  @IsNumber() @Min(-180) @Max(180) longitude!:number;
  @IsISO8601({strict:true}) availableUntil!:string;
}

class OrderExceptionDto {
 @IsIn(exceptionActions) action!:ExceptionAction;
 @IsIn(exceptionReasons) reason!:string;
 @IsString() @MaxLength(32) expectedStatus!:string;
 @IsUUID() requestId!:string;
 @IsOptional() @IsString() @MaxLength(1000) comment?:string;
 @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({each:true}) photos?:string[];
}

@Controller("orders")
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  @Get("notifications")
  async notifications(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    return this.ordersService.getNotifications(user.id, user.role);
  }

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

  @Patch("cleaner/preferences")
  async cleanerPreferences(@Req() request:Request,@Body() body:CleanerPreferencesDto){
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="cleaner"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    return this.ordersService.updateCleanerPreferences(user.id,body);
  }
  @Patch("cleaner/location")
  async cleanerLocation(@Req() request:Request,@Body() body:CleanerLocationDto){
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="cleaner"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    return this.ordersService.refreshCleanerLocation(user.id,body);
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

  @Get(":id/exception")
  async exceptionState(@Param("id",ParseUUIDPipe) id:string,@Req() request:Request){
    const user=(request as AuthenticatedRequest).user;
    if(!user.phoneVerifiedAt||!["client","cleaner"].includes(user.role))throw new ForbiddenException("Требуется подтверждённый профиль");
    return this.ordersService.getExceptionState(id,user.id,user.role as "client"|"cleaner");
  }
  @Post(":id/exception")
  async orderException(@Param("id",ParseUUIDPipe) id:string,@Req() request:Request,@Body() body:OrderExceptionDto){
    const user=(request as AuthenticatedRequest).user;
    if(!user.phoneVerifiedAt||!["client","cleaner"].includes(user.role))throw new ForbiddenException("Требуется подтверждённый профиль");
    return this.ordersService.handleOrderException(id,user.id,user.role as "client"|"cleaner",body);
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
    if (!clientHistorySections.includes(section as ClientHistorySection) || !/^[1-9]\d*$/.test(pageValue)) {
      throw new BadRequestException("Некорректные параметры истории");
    }
    const page = Number(pageValue);
    if (!Number.isSafeInteger(page) || page > 100000) {
      throw new BadRequestException("Некорректный номер страницы");
    }
    return this.ordersService.findMinePage(user.id, section as ClientHistorySection, page);
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

  @Get(":id/counterpart-avatar")
  async counterpartAvatar(@Param("id",ParseUUIDPipe) id:string,@Req() request:Request) {
    const user=(request as AuthenticatedRequest).user;
    if(!user.phoneVerifiedAt||!["client","cleaner"].includes(user.role))throw new ForbiddenException("Требуется подтверждённый профиль");
    const result=await this.ordersService.getCounterpartAvatar(id,user.id,user.role);
    if(!result)throw new NotFoundException("Заказ не найден");
    return result;
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

  @Get("cleaner/history")
  async cleanerHistory(@Req() request:Request,@Query("page") pageValue="1"){
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="cleaner"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    const page=Number(pageValue);
    if(!/^[1-9]\d*$/.test(pageValue)||!Number.isSafeInteger(page)||page>100000)throw new BadRequestException("Некорректный номер страницы");
    return this.ordersService.findCleanerHistory(user.id,page);
  }

  @Get("cleaner/history/:id")
  async cleanerHistoryDetail(@Param("id",ParseUUIDPipe) id:string,@Req() request:Request){
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="cleaner"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    const item=await this.ordersService.findCleanerHistoryDetail(user.id,id);
    if(!item)throw new NotFoundException("Заказ не найден");
    return item;
  }

  @Get("cleaner/jobs")
  async findCleanerJobs(@Req() request: Request) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.findCleanerJobs(user.id);
  }

  @Patch(":id/trip-location")
  async updateTripLocation(@Param("id") id:string,@Req() request:Request,@Body() body:{latitude?:number|null;longitude?:number|null}) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="cleaner" || !user.phoneVerifiedAt) throw new ForbiddenException("Требуется подтверждённый клинер");
    if(body.latitude!==null && body.latitude!==undefined && typeof body.latitude!=="number") throw new BadRequestException("Некорректная широта");
    if(body.longitude!==null && body.longitude!==undefined && typeof body.longitude!=="number") throw new BadRequestException("Некорректная долгота");
    return this.ordersService.updateTripLocation(id,user.id,body.latitude??null,body.longitude??null);
  }

  @Patch(":id/en-route")
  async markEnRoute(@Param("id") id: string, @Req() request: Request, @Body() body: { travelMode?: string; latitude?: number; longitude?: number }) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) throw new ForbiddenException("Требуется подтверждённый клинер");
    return this.ordersService.markEnRoute(id, user.id, body ?? {});
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


  @Patch(":id/inspection")
  async inspection(@Param("id") id:string,@Req() request:Request,@Body() body:{method:"personal"|"photos"}) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="client"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется клиент");
    if(!body || !["personal","photos"].includes(body.method))throw new BadRequestException("Некорректный способ проверки");
    return this.ordersService.setInspectionMethod(id,user.id,body.method);
  }

  @Patch(":id/confirm-completion")
  async confirmCompletion(@Param("id") id:string,@Req() request:Request) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="client"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется клиент");
    return this.ordersService.confirmCompletion(id,user.id);
  }

  @Patch(":id/completion-issue")
  async completionIssue(@Param("id") id:string,@Req() request:Request) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="client"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется клиент");
    return this.ordersService.reportCompletionIssue(id,user.id);
  }

  @Post(":id/review")
  async review(@Param("id") id:string,@Req() request:Request,@Body() body:{rating:number;reviewText?:string}) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="client"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется клиент");
    if(!body||!Number.isFinite(body.rating)||body.rating<0.5||body.rating>5||!Number.isInteger(body.rating*2)|| (body.reviewText!=null && (typeof body.reviewText!=="string"||body.reviewText.length>1000)))
      throw new BadRequestException("Неверная оценка или текст отзыва");
    return this.ordersService.leaveReview(id,user.id,body.rating,body.reviewText);
  }

  @Get(":id/cleaner-reputation")
  async reputation(@Param("id") id:string,@Req() request:Request) {
    const user=(request as AuthenticatedRequest).user;
    if(user.role!=="client"||!user.phoneVerifiedAt)throw new ForbiddenException("Требуется клиент");
    const order=await this.ordersService.findOneForClient(id,user.id);
    if(!order?.cleanerId)throw new NotFoundException("Клинер не найден");
    return this.ordersService.cleanerReputation(order.cleanerId);
  }

  @Patch(":id/complete")
  async completeCleaning(@Param("id") id: string, @Req() request: Request, @Body() body: {photos?:string[]}) {
    const user = (request as AuthenticatedRequest).user;
    if (user.role !== "cleaner" || !user.phoneVerifiedAt) {
      throw new ForbiddenException("Требуется подтверждённый профиль клинера");
    }
    return this.ordersService.completeCleaning(id, user.id, body?.photos ?? []);
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
