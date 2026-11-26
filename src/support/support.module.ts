import {Module} from "@nestjs/common";
import {AuthModule} from "../auth/auth.module.js";
import {SupportController} from "./support.controller.js";
import {SupportService} from "./support.service.js";
import {AdminController} from "./admin.controller.js";
import {AdminAuthService,AdminGuard} from "./admin-auth.js";
import {AdminDataService} from "./admin-data.service.js";
@Module({imports:[AuthModule],controllers:[SupportController,AdminController],providers:[SupportService,AdminAuthService,AdminGuard,AdminDataService]})
export class SupportModule{}
