import {Controller,ForbiddenException,Get,Query,Req,UseGuards,BadRequestException} from "@nestjs/common";
import type {Request} from "express";
import {AuthGuard,type AuthenticatedRequest} from "../auth/auth.guard.js";
import {SupportService} from "./support.service.js";
@Controller("support")
@UseGuards(AuthGuard)
export class SupportController{
 constructor(private readonly service:SupportService){}
 @Get("mine") mine(@Req() req:Request,@Query("page") p="1"){const u=(req as AuthenticatedRequest).user;if(!u.phoneVerifiedAt)throw new ForbiddenException("Подтвердите телефон");const n=Number(p);if(!Number.isInteger(n)||n<1||n>10000)throw new BadRequestException("Некорректная страница");return this.service.mine(u.id,n);}
 @Get("access") access(){return {staff:false};}
}
