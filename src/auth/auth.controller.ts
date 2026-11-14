import { Body, Controller, Get, Headers, Patch, Post, UnauthorizedException } from "@nestjs/common";
import { IsIn, IsString, MinLength } from "class-validator";
import { AuthService } from "./auth.service.js";

class TelegramLoginDto {
  @IsString()
  @MinLength(1)
  initData!: string;
}
class SelectRoleDto {
  @IsIn(["client", "cleaner"])
  role!: "client" | "cleaner";
}
function bearer(header?: string): string {
  const match = /^Bearer (\S+)$/i.exec(header ?? "");
  if (!match) throw new UnauthorizedException("Bearer token required");
  return match[1];
}
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("telegram")
  login(@Body() body: TelegramLoginDto) { return this.auth.telegram(body.initData); }
  @Get("me")
  me(@Headers("authorization") header?: string) { return this.auth.me(bearer(header)); }
  @Patch("role")
  role(@Headers("authorization") header: string | undefined, @Body() body: SelectRoleDto) {
    return this.auth.setRole(bearer(header), body.role);
  }
}
