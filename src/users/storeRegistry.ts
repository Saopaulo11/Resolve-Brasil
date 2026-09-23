import { loadConfig } from "../config/env";
import { isDatabaseConfigured } from "../services/db";
import { logger } from "../utils/logger";
import {
  MemoryConsentStore,
  MemoryOtpStore,
  MemorySessionStore,
  MemoryUserStore,
} from "./memoryStores";
import {
  PrismaConsentStore,
  PrismaOtpStore,
  PrismaSessionStore,
  PrismaUserStore,
  type ConsentStore,
  type OtpStore,
  type SessionStore,
  type UserStore,
} from "./stores";

/**
 * Выбор хранилищ. Есть DATABASE_URL — Prisma, нет — память.
 *
 * Падать без базы нельзя: до появления PostgreSQL вход всё равно нужно
 * поднимать и проверять. В production этой развилки не существует —
 * loadConfig() там требует DATABASE_URL и не даёт процессу стартовать без него.
 */
export type Stores = {
  users: UserStore;
  otp: OtpStore;
  sessions: SessionStore;
  consents: ConsentStore;
};

let instance: Stores | null = null;

function build(): Stores {
  if (isDatabaseConfigured()) {
    return {
      users: new PrismaUserStore(),
      otp: new PrismaOtpStore(),
      sessions: new PrismaSessionStore(),
      consents: new PrismaConsentStore(),
    };
  }

  const config = loadConfig();
  if (config.isProduction) {
    // Недостижимо при исправной конфигурации, но пусть будет громко:
    // хранение сессий в памяти в production означало бы молчаливую потерю
    // всех дел при каждом перезапуске.
    throw new Error("Хранилища в памяти недопустимы в production: задайте DATABASE_URL.");
  }

  logger().warn(
    "DATABASE_URL не задан — использую хранилища в памяти. Данные исчезнут " +
      "при перезапуске. Так можно только в разработке.",
  );

  return {
    users: new MemoryUserStore(),
    otp: new MemoryOtpStore(),
    sessions: new MemorySessionStore(),
    consents: new MemoryConsentStore(),
  };
}

export function stores(): Stores {
  if (!instance) instance = build();
  return instance;
}

/** Для тестов: подставить свои хранилища. */
export function setStores(custom: Stores): void {
  instance = custom;
}

export function resetStores(): void {
  instance = null;
}
