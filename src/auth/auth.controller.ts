
import {
  Body,
  Controller,
  Headers,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  IsIn,
  ValidateIf,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

import type { Request } from "express";

import { AuthService } from "./auth.service.js";
import {
  AuthGuard,
  type AuthenticatedRequest,
} from "./auth.guard.js";

class TelegramLoginDto {
  @IsString()
  @IsNotEmpty()
  initData!: string;
}

class PhoneCodeDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone!: string;
}

class VerifyPhoneDto extends PhoneCodeDto {
  @IsString()
  @Matches(/^\d{4,10}$/)
  @MaxLength(10)
  code!: string;
}

class SelectRoleDto {
  @IsIn(["client", "cleaner"])
  role!: "client" | "cleaner";
}

class UpdateProfileDto {
  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @MaxLength(60)
  firstName?: string;

  @ValidateIf((_object,value)=>value!==undefined)
  @IsString()
  @MaxLength(60)
  lastName?: string;

  @ValidateIf((_object,value)=>value!==undefined&&value!==null)
  @IsString()
  @MaxLength(180000)
  avatar?: string | null;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post("telegram/contact-webhook")
  async telegramContactWebhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() update: Parameters<AuthService["confirmTelegramContact"]>[0],
  ) {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expected || !secret || secret !== expected) {
      throw new ForbiddenException("Invalid webhook secret");
    }
    await this.authService.confirmTelegramContact(update);
    return { ok: true };
  }

  @Post("telegram")
  loginTelegram(
    @Body() body: TelegramLoginDto,
  ) {
    return this.authService.loginWithTelegram(
      body.initData,
    );
  }

  @UseGuards(AuthGuard)
  @Post("phone/send-code")
  sendCode(
    @Req() request: Request,
    @Body() body: PhoneCodeDto,
  ) {
    return this.authService.sendPhoneCode(
      (request as AuthenticatedRequest).user.id,
      body.phone,
    );
  }

  @UseGuards(AuthGuard)
  @Post("phone/verify")
  verifyPhone(
    @Req() request: Request,
    @Body() body: VerifyPhoneDto,
  ) {
    return this.authService.verifyPhoneCode(
      (request as AuthenticatedRequest).user.id,
      body.phone,
      body.code,
    );
  }

  @UseGuards(AuthGuard)
  @Patch("role")
  selectRole(@Req() request: Request, @Body() body: SelectRoleDto) {
    return this.authService.selectRole(
      (request as AuthenticatedRequest).user.id,
      body.role,
    );
  }

  @UseGuards(AuthGuard)
  @Get("profile")
  getProfile(@Req() request:Request) {
    return this.authService.getProfile((request as AuthenticatedRequest).user.id);
  }

  @UseGuards(AuthGuard)
  @Patch("profile")
  updateProfile(@Req() request:Request,@Body() body:UpdateProfileDto) {
    const user=(request as AuthenticatedRequest).user;
    if(!user.phoneVerifiedAt||!["client","cleaner"].includes(user.role))throw new ForbiddenException("Подтвердите телефон и выберите роль");
    return this.authService.updateProfile(user.id,body);
  }

  @UseGuards(AuthGuard)
  @Get("me")
  getMe(
    @Req() request: Request,
  ) {
    return (request as AuthenticatedRequest).user;
  }
}
