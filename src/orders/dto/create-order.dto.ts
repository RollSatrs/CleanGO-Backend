
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  IsPositive,
  IsIn,
  Matches,
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

  @IsIn(["regular", "general", "renovation"])
  cleaningType!: "regular" | "general" | "renovation";
}
