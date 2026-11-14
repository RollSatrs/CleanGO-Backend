
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import type { Request } from "express";

import {
  AuthService,
  type AuthUser,
} from "./auth.service.js";

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const authorization =
      request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException(
        "Необходимо войти в аккаунт",
      );
    }

    const [scheme, token, extra] =
      authorization.split(" ");

    if (
      scheme !== "Bearer" ||
      !token ||
      extra
    ) {
      throw new UnauthorizedException(
        "Неверный формат авторизации",
      );
    }

    request.user =
      await this.authService.verifyAccessToken(
        token,
      );

    return true;
  }
}
