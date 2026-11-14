
import {
  Controller,
  Get,
  Query,
} from "@nestjs/common";

import { PricingService } from "./pricing.service.js";

import {
  IsIn,
  IsInt,
  Max,
  Min,
} from "class-validator";

import { Type } from "class-transformer";

class GetPriceDto {
  @IsIn(["regular", "general", "renovation"])
  cleaningType!: "regular" | "general" | "renovation";

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  area!: number;
}

@Controller("pricing")
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
  ) {}

  @Get("quote")
  getQuote(@Query() query: GetPriceDto) {
    return this.pricingService.calculate(
      query.cleaningType,
      query.area,
    );
  }
}
