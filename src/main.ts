
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useBodyParser("json", { limit: "3mb" });
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
      // Telegram Mini App can be hosted on a temporary HTTPS ngrok domain.
      const allowedOrigins = new Set([
        "http://localhost:3000",
        "https://clean-go-frontend.vercel.app",
        ...(process.env.FRONTEND_URL ?? "")
          .split(",")
          .map((value) => value.trim().replace(/\/$/, ""))
          .filter(Boolean),
      ]);
      const isDevTunnel = Boolean(origin) &&
        /^https:\/\/[a-z0-9-]+\.ngrok(-free)?\.app$/.test(origin!);
      if (!origin || allowedOrigins.has(origin) || isDevTunnel) {
        callback(null, true);
      } else {
        callback(new Error("CORS origin not allowed"), false);
      }
    },
    credentials: true,
  });


  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3001);
}

void bootstrap();
