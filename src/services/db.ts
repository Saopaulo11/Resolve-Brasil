import { PrismaPg } from "@prisma/adapter-pg";

import { loadConfig } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Единственный клиент Prisma на процесс.
 *
 * Создаётся лениво, по первому обращению: если строить его на уровне модуля,
 * то `npm run build`, тесты и любой импорт из этого файла начнут требовать
 * DATABASE_URL — и CI без базы перестанет собираться.
 */
let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (client) return client;

  const config = loadConfig();
  if (!config.database.url) {
    throw new Error(
      "DATABASE_URL не задан — работа с базой невозможна. См. .env.example.",
    );
  }

  const adapter = new PrismaPg({ connectionString: config.database.url });
  client = new PrismaClient({ adapter });
  return client;
}

/** Есть ли вообще конфигурация базы. Для /health, чтобы не бросать исключение. */
export function isDatabaseConfigured(): boolean {
  return Boolean(loadConfig().database.url);
}

export async function disconnectDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
