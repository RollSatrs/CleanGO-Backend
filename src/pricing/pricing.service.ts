
import {
  BadRequestException,
  Injectable,
} from "@nestjs/common";

export type CleaningType =
  | "regular"
  | "general"
  | "renovation";

type Tariff = {
  pricePerSquareMeter: number;
  minimumPrice: number;
};

@Injectable()
export class PricingService {
  private readonly tariffs: Record<CleaningType, Tariff> = {
    regular: {
      pricePerSquareMeter: 300,
      minimumPrice: 8000,
    },

    general: {
      pricePerSquareMeter: 600,
      minimumPrice: 15000,
    },

    renovation: {
      pricePerSquareMeter: 800,
      minimumPrice: 20000,
    },
  };

  calculate(cleaningType: CleaningType, area: number) {
    if (!Number.isInteger(area) || area <= 0 || area > 1000) {
      throw new BadRequestException(
        "Площадь должна быть целым числом от 1 до 1000 м²",
      );
    }

    const tariff = this.tariffs[cleaningType];

    if (!tariff) {
      throw new BadRequestException("Неизвестный тип уборки");
    }

    const calculatedPrice = area * tariff.pricePerSquareMeter;

    const totalPrice = Math.max(
      calculatedPrice,
      tariff.minimumPrice,
    );

    return {
      cleaningType,
      area,
      pricePerSquareMeter: tariff.pricePerSquareMeter,
      minimumPrice: tariff.minimumPrice,
      totalPrice,
      currency: "KZT",
    };
  }
}
