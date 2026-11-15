
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";

import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { users } from "../db/schema.js";

export type AuthUser = {
  id: string;
  telegramId: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
};

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
};

@Injectable()
export class AuthService {
  // ==========================================
  // CONFIGURATION
  // ==========================================

  private getJwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
      throw new InternalServerErrorException(
        "JWT_SECRET не настроен",
      );
    }

    return new TextEncoder().encode(secret);
  }

  private getTelegramToken() {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      throw new InternalServerErrorException(
        "TELEGRAM_BOT_TOKEN не настроен",
      );
    }

    return token;
  }

  private getTwilioConfig() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const service = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!sid || !token || !service) {
      throw new InternalServerErrorException(
        "Twilio Verify не настроен",
      );
    }

    return { sid, token, service };
  }

  // ==========================================
  // PHONE VALIDATION
  // ==========================================

  private validatePhone(phone: string) {
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new BadRequestException(
        "Введите номер в международном формате",
      );
    }

    return phone;
  }

  // ==========================================
  // TWILIO REQUEST
  // ==========================================

  private async twilioRequest(
    endpoint: string,
    values: Record<string, string>,
  ) {
    const config = this.getTwilioConfig();

    const authorization = Buffer.from(
      `${config.sid}:${config.token}`,
    ).toString("base64");

    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${config.service}/${endpoint}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authorization}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values),
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() => {
      throw new BadGatewayException(
        "SMS-сервис временно недоступен",
      );
    });

    if (!response.ok) {
      throw new BadGatewayException(
        "SMS-сервис не выполнил запрос",
      );
    }

    return (await response.json()) as {
      status?: string;
    };
  }

  // ==========================================
  // SEND PHONE CODE
  // ==========================================

  async sendPhoneCode(phone: string) {
    const normalizedPhone = this.validatePhone(phone);

    await this.twilioRequest("Verifications", {
      To: normalizedPhone,
      Channel: "sms",
    });

    return {
      message: "Если номер доступен, код отправлен",
    };
  }

  // ==========================================
  // VERIFY PHONE CODE
  // ==========================================

  async verifyPhoneCode(phone: string, code: string) {
    const normalizedPhone = this.validatePhone(phone);

    if (!/^\d{4,10}$/.test(code)) {
      throw new BadRequestException(
        "Неверный формат кода",
      );
    }

    const result = await this.twilioRequest(
      "VerificationCheck",
      {
        To: normalizedPhone,
        Code: code,
      },
    );

    if (result.status !== "approved") {
      throw new UnauthorizedException(
        "Неверный или просроченный код",
      );
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.phone, normalizedPhone))
      .limit(1);

    let user = existing[0];

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({
          phone: normalizedPhone,
          role: "unselected",
        })
        .onConflictDoNothing({
          target: users.phone,
        })
        .returning();

      if (created) {
        user = created;
      } else {
        const [found] = await db
          .select()
          .from(users)
          .where(eq(users.phone, normalizedPhone))
          .limit(1);

        user = found;
      }
    }

    if (!user) {
      throw new InternalServerErrorException(
        "Не удалось создать пользователя",
      );
    }

    return this.createSession(user);
  }

  // ==========================================
  // TELEGRAM AUTHENTICATION
  // ==========================================

  async loginWithTelegram(initData: string) {
    const token = this.getTelegramToken();

    if (
      typeof initData !== "string" ||
      !initData.trim()
    ) {
      throw new UnauthorizedException(
        "Данные Telegram отсутствуют",
      );
    }

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");
    const rawUser = params.get("user");
    const authDateRaw = params.get("auth_date");

    const debugEnabled =
      process.env.TELEGRAM_AUTH_DEBUG === "true";

    if (
      !receivedHash ||
      !rawUser ||
      !authDateRaw
    ) {
      throw new UnauthorizedException(
        "Некорректные данные Telegram",
      );
    }

    // ==========================================
    // CHECK AUTH DATE
    // ==========================================

    const authDate = Number(authDateRaw);
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isSafeInteger(authDate) ||
      authDate <= 0 ||
      authDate > now + 60 ||
      now - authDate > 300
    ) {
      throw new UnauthorizedException(
        "Данные Telegram устарели",
      );
    }

    // ==========================================
    // BUILD DATA CHECK STRING
    // ==========================================

    // Проверка через токен бота:
    // исключаем только hash.
    //
    // signature остаётся в строке проверки,
    // если Telegram передал это поле.

    const entries = [...params.entries()];

    const sortedEntries = entries.sort(
      ([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
    );

    const dataCheckString = sortedEntries
      .filter(([key]) => key !== "hash")
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Дополнительный вариант только для диагностики.
    // Он НЕ используется для разрешения входа.

    const withoutSignatureString = sortedEntries
      .filter(
        ([key]) =>
          key !== "hash" &&
          key !== "signature",
      )
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // ==========================================
    // TELEGRAM HMAC-SHA256
    // ==========================================

    const secretKey = createHmac(
      "sha256",
      "WebAppData",
    )
      .update(token)
      .digest();

    const calculatedHash = createHmac(
      "sha256",
      secretKey,
    )
      .update(dataCheckString)
      .digest();

    const diagnosticHash = createHmac(
      "sha256",
      secretKey,
    )
      .update(withoutSignatureString)
      .digest();

    if (!/^[0-9a-f]{64}$/i.test(receivedHash)) {
      throw new UnauthorizedException(
        "Неверная подпись Telegram",
      );
    }

    const providedHash = Buffer.from(
      receivedHash,
      "hex",
    );

    const canonicalMatch =
      calculatedHash.length === providedHash.length &&
      timingSafeEqual(calculatedHash, providedHash);

    const withoutSignatureMatch =
      diagnosticHash.length === providedHash.length &&
      timingSafeEqual(diagnosticHash, providedHash);

    // ==========================================
    // SAFE DEBUG LOGGING
    // ==========================================

    if (debugEnabled) {
      console.log("[Telegram Auth Debug]", {
        fields: [...params.keys()].sort(),
        hasHash: Boolean(receivedHash),
        hasUser: Boolean(rawUser),
        hasAuthDate: Boolean(authDateRaw),
        hasSignature: params.has("signature"),
        canonicalMatch,
        withoutSignatureMatch,
      });
    }

    // Только официальная HMAC-проверка
    // разрешает авторизацию.

    if (!canonicalMatch) {
      throw new UnauthorizedException(
        "Проверка Telegram не пройдена",
      );
    }

    // ==========================================
    // PARSE TELEGRAM USER
    // ==========================================

    let telegramUser: TelegramUser;

    try {
      telegramUser = JSON.parse(
        rawUser,
      ) as TelegramUser;
    } catch {
      throw new UnauthorizedException(
        "Некорректный пользователь Telegram",
      );
    }

    if (
      !Number.isSafeInteger(telegramUser.id) ||
      telegramUser.id <= 0
    ) {
      throw new UnauthorizedException(
        "Некорректный Telegram ID",
      );
    }

    const telegramId = BigInt(telegramUser.id);

    // ==========================================
    // FIND USER
    // ==========================================

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    let user = existing[0];

    // ==========================================
    // CREATE USER IF NOT EXISTS
    // ==========================================

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({
          telegramId,
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          role: "unselected",
        })
        .onConflictDoNothing({
          target: users.telegramId,
        })
        .returning();

      if (created) {
        user = created;
      } else {
        const [found] = await db
          .select()
          .from(users)
          .where(eq(users.telegramId, telegramId))
          .limit(1);

        user = found;
      }
    }

    if (!user) {
      throw new InternalServerErrorException(
        "Не удалось создать пользователя",
      );
    }

    // ==========================================
    // ISSUE JWT
    // ==========================================

    return this.createSession(user);
  }

  // ==========================================
  // SELECT ROLE
  // ==========================================

  async selectRole(userId: string, role: "client" | "cleaner") {
    // Atomic conditional update prevents overwriting a previously selected role.
    const [updated] = await db
      .update(users)
      .set({ role })
      .where(and(eq(users.id, userId), eq(users.role, "unselected")))
      .returning();

    if (updated) return this.toPublicUser(updated);

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!existing) throw new UnauthorizedException("Пользователь не найден");
    if (existing.role === role) return this.toPublicUser(existing);
    throw new BadRequestException("Роль уже выбрана");
  }

  // ==========================================
  // PUBLIC USER
  // ==========================================

  private toPublicUser(
    user: typeof users.$inferSelect,
  ): AuthUser {
    return {
      id: user.id,
      telegramId:
        user.telegramId?.toString() ?? null,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }

  // ==========================================
  // CREATE SESSION
  // ==========================================

  private async createSession(
    user: typeof users.$inferSelect,
  ) {
    const token = await new SignJWT({
      role: user.role,
    })
      .setProtectedHeader({
        alg: "HS256",
      })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(this.getJwtSecret());

    return {
      accessToken: token,
      tokenType: "Bearer",
      user: this.toPublicUser(user),
    };
  }

  // ==========================================
  // VERIFY ACCESS TOKEN
  // ==========================================

  async verifyAccessToken(token: string) {
    try {
      const { payload } = await jwtVerify(
        token,
        this.getJwtSecret(),
        {
          algorithms: ["HS256"],
        },
      );

      if (
        typeof payload.sub !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(payload.sub)
      ) {
        throw new Error("Invalid subject");
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      return this.toPublicUser(user);
    } catch {
      throw new UnauthorizedException(
        "Требуется авторизация",
      );
    }
  }
}
