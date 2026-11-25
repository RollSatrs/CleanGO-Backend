import {Body,Controller,ForbiddenException,Get,Param,ParseUUIDPipe,Patch,Query,Req,UseGuards,BadRequestException} from "@nestjs/common";
import type {Request} from "express";
import {AuthGuard,type AuthenticatedRequest} from "../auth/auth.guard.js";
import {SupportService} from "./support.service.js";
import {canManageSupport,supportActions,type SupportAction} from "./support-rules.js";

function user(req:Request){const u=(req as AuthenticatedRequest).user;if(!u.phoneVerifiedAt)throw new ForbiddenException("Подтвердите телефон");return u;}
function staff(req:Request){const u=user(req);if(!canManageSupport(u,process.env.CLEANGO_ADMIN_USER_IDS))throw new ForbiddenException("Нет доступа к панели поддержки");return u;}
function page(value:string){const n=Number(value||"1");if(!Number.isInteger(n)||n<1||n>10000)throw new BadRequestException("Некорректная страница");return n;}
@Controller("support")
@UseGuards(AuthGuard)
export class SupportController{
 constructor(private readonly service:SupportService){}
 @Get("mine") mine(@Req() req:Request,@Query("page") p="1"){return this.service.mine(user(req).id,page(p));}
 @Get("access") access(@Req() req:Request){return {staff:canManageSupport(user(req),process.env.CLEANGO_ADMIN_USER_IDS)};}
 @Get("admin/overview") overview(@Req() req:Request){staff(req);return this.service.overview();}
 @Get("admin/orders") orders(@Req() req:Request,@Query("page") p="1"){staff(req);return this.service.ordersPage(page(p));}
 @Get("admin/users") users(@Req() req:Request,@Query("page") p="1"){staff(req);return this.service.usersPage(page(p));}
 @Get("admin/cases") queue(@Req() req:Request,@Query("status") status="open",@Query("page") p="1"){staff(req);if(!["open","in_review","resolved","all"].includes(status))throw new BadRequestException("Некорректный статус");return this.service.queue(status,page(p));}
 @Get("admin/cases/:id") detail(@Req() req:Request,@Param("id",ParseUUIDPipe) id:string){staff(req);return this.service.detail(id);}
 @Patch("admin/cases/:id") act(@Req() req:Request,@Param("id",ParseUUIDPipe) id:string,@Body() body:{action:SupportAction;note?:string}){
   const u=staff(req);if(!body||!supportActions.includes(body.action)||(body.note!==undefined&&typeof body.note!=="string"))throw new BadRequestException("Некорректное действие");return this.service.act(id,u.id,body.action,body.note??"");
 }
}
