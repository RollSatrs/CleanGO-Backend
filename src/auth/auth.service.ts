import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

type TelegramUser = { id: number; first_name?: string; last_name?: string };
type TokenPayload = { sub: string; exp: number; iat: number };

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required");
  return value;
}
function digest(value: string): Buffer {
  return createHmac("sha256", secret("JWT_SECRET")).update(value).digest();
}
function encode(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}
function issueToken(id: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ sub: id, iat: now, exp: now + 7 * 86400 });
  const body = header + "." + payload;
  return body + "." + digest(body).toString("base64url");
}
function verifyToken(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new UnauthorizedException("Invalid token");
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) throw new UnauthorizedException("Invalid token");
  const body = header + "." + payload;
  const expected = digest(body);
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); }
  catch { throw new UnauthorizedException("Invalid token"); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new UnauthorizedException("Invalid token");
  }
  try {
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenPayload;
    if (h.alg !== "HS256" || typeof p.sub !== "string" || !p.sub ||
        !Number.isSafeInteger(p.exp) || p.exp <= Date.now() / 1000) throw new Error("expired");
    return p.sub;
  } catch { throw new UnauthorizedException("Invalid or expired token"); }
}
function verifyTelegram(initData: string): TelegramUser {
  if (!initData || initData.length > 8192) throw new UnauthorizedException("Invalid Telegram data");
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new UnauthorizedException("Duplicate Telegram fields");
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash) || !Number.isSafeInteger(authDate)) {
    throw new UnauthorizedException("Invalid Telegram data");
  }
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > 86400) throw new UnauthorizedException("Telegram login expired");
  const check = [...params.entries()].filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + "=" + value).join("\n");
  const key = createHmac("sha256", "WebAppData").update(secret("TELEGRAM_BOT_TOKEN")).digest();
  const expected = createHmac("sha256", key).update(check).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new UnauthorizedException("Telegram signature invalid");
  }
  try {
    const user = JSON.parse(params.get("user") ?? "") as TelegramUser;
    if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error("Invalid id");
    return user;
  } catch { throw new UnauthorizedException("Telegram user missing"); }
}
function publicUser(user: typeof users.$inferSelect) {
  return { id: user.id, telegramId: user.telegramId, phone: user.phone,
    firstName: user.firstName, lastName: user.lastName, role: user.role,
    cleanerStatus: user.cleanerStatus };
}

@Injectable()
export class AuthService {
  async telegram(initData: string) {
    const telegramUser = verifyTelegram(initData);
    const telegramId = String(telegramUser.id);
    const [user] = await db.insert(users).values({
      telegramId, firstName: telegramUser.first_name ?? null,
      lastName: telegramUser.last_name ?? null,
    }).onConflictDoUpdate({
      target: users.telegramId,
      set: { firstName: telegramUser.first_name ?? null, lastName: telegramUser.last_name ?? null },
    }).returning();
    return { accessToken: issueToken(user.id), user: publicUser(user) };
  }
  async me(token: string) {
    const id = verifyToken(token);
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new UnauthorizedException("User not found");
    return publicUser(user);
  }
  async setRole(token: string, role: string) {
    if (role !== "client" && role !== "cleaner") throw new BadRequestException("Invalid role");
    const id = verifyToken(token);
    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) throw new UnauthorizedException("User not found");
    if (existing.role !== "unselected" && existing.role !== role) {
      throw new BadRequestException("Role already selected");
    }
    const [user] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    return publicUser(user);
  }
}
