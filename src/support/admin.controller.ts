import {Body,Controller,Get,Post,Patch,Req,Param,Query,UseGuards,ParseUUIDPipe,BadRequestException,Header} from "@nestjs/common";
import {AdminAuthService,AdminGuard,type AdminRequest} from "./admin-auth.js";
import {AdminDataService} from "./admin-data.service.js";
import {SupportService} from "./support.service.js";
import {supportActions,type SupportAction} from "./support-rules.js";
function page(v:string){const n=Number(v);if(!Number.isInteger(n)||n<1||n>10000)throw new BadRequestException("Некорректная страница");return n;}
@Controller("admin")
export class AdminController{
 constructor(private readonly auth:AdminAuthService,private readonly data:AdminDataService,private readonly support:SupportService){}
 @Header("Cache-Control","no-store") @Post("session/start") start(@Body() body:{key?:unknown}){return this.auth.start(body?.key);}
 @Header("Cache-Control","no-store") @Post("session/verify") verify(@Body() body:{challengeId?:unknown;code?:unknown}){return this.auth.verify(body?.challengeId,body?.code);}
 @UseGuards(AdminGuard) @Get("session/me") me(@Req() req:AdminRequest){return {id:req.admin.id,name:req.admin.name};}
 @UseGuards(AdminGuard) @Post("session/logout") logout(@Req() req:AdminRequest){this.auth.logout(req.adminToken);return {ok:true};}
 @UseGuards(AdminGuard) @Get("dashboard") async dashboard(){return {...await this.support.overview(),...await this.data.dashboard()};}
 @UseGuards(AdminGuard) @Get("orders") orders(@Query("page") p="1",@Query("status") status?:string,@Query("q") q?:string,@Query("userId") userId?:string){if(userId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId))throw new BadRequestException("Некорректный ID");return this.data.ordersPage(page(p),status,q,userId);}
 @UseGuards(AdminGuard) @Get("orders/:id") order(@Param("id",ParseUUIDPipe) id:string){return this.data.order(id);}
 @UseGuards(AdminGuard) @Get("users") users(@Query("page") p="1",@Query("role") role?:string,@Query("q") q?:string){return this.data.usersPage(page(p),role,q);}
 @Header("Cache-Control","no-store") @UseGuards(AdminGuard) @Get("users/:id/avatar") avatar(@Param("id",ParseUUIDPipe) id:string){return this.data.avatar(id);}
 @Header("Cache-Control","no-store") @UseGuards(AdminGuard) @Get("orders/:id/photos/:index") photo(@Param("id",ParseUUIDPipe) id:string,@Param("index") index:string){if(!/^\d{1,2}$/.test(index))throw new BadRequestException("Некорректное фото");return this.data.completionPhoto(id,Number(index));}
 @UseGuards(AdminGuard) @Get("users/:id") user(@Param("id",ParseUUIDPipe) id:string){return this.data.user(id);}
 @UseGuards(AdminGuard) @Get("reviews") reviews(@Query("page") p="1",@Query("userId") userId?:string){if(userId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId))throw new BadRequestException("Некорректный ID");return this.data.reviews(page(p),userId);}
 @UseGuards(AdminGuard) @Get("cases") cases(@Query("page") p="1",@Query("status") status="open"){if(!["open","in_review","resolved","all"].includes(status))throw new BadRequestException("Некорректный статус");return this.support.queue(status,page(p));}
 @UseGuards(AdminGuard) @Get("cases/:id") detail(@Param("id",ParseUUIDPipe) id:string){return this.support.detail(id);}
 @UseGuards(AdminGuard) @Patch("cases/:id") act(@Req() req:AdminRequest,@Param("id",ParseUUIDPipe) id:string,@Body() body:{action:SupportAction;note?:string}){if(!body||!supportActions.includes(body.action)||(body.note!==undefined&&typeof body.note!=="string"))throw new BadRequestException("Некорректное действие");return this.support.act(id,req.admin.id,body.action,body.note??"");}
}
