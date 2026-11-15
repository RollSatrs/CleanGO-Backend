
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  IsIn,
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
  @Get("me")
  getMe(
    @Req() request: Request,
  ) {
    return (request as AuthenticatedRequest).user;
  }
}
