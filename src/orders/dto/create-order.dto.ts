
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsPositive,
  IsIn,
  Matches,
  IsOptional,
  Min,
  Max,
} from "class-validator";

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, {
    message: "Адрес не может состоять из пробелов",
  })
  address!: string;

  @IsNumber()
  @IsInt()
  @IsPositive()
  area!: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsIn(["regular", "general", "renovation"])
  cleaningType!: "regular" | "general" | "renovation";
}
