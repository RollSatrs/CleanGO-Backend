
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
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

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post("telegram")
  loginTelegram(
    @Body() body: TelegramLoginDto,
  ) {
    return this.authService.loginWithTelegram(
      body.initData,
    );
  }

  @Post("phone/send-code")
  sendCode(
    @Body() body: PhoneCodeDto,
  ) {
    return this.authService.sendPhoneCode(
      body.phone,
    );
  }

  @Post("phone/verify")
  verifyPhone(
    @Body() body: VerifyPhoneDto,
  ) {
    return this.authService.verifyPhoneCode(
      body.phone,
      body.code,
    );
  }

  @UseGuards(AuthGuard)
  @Get("me")
  getMe(
    @Req() request: Request,
  ) {
    return (request as AuthenticatedRequest).user;
  }
}
