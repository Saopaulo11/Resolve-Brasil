import { PrismaPg } from "@prisma/adapter-pg";

import { loadConfig } from "../config/env";
import { stripTlsParams } from "../config/databaseUrl";
import { logger } from "../utils/logger";
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

  const { url } = stripTlsParams(config.database.url);

  // TLS задаётся здесь, а не в строке: pg перебивает явные настройки тем,
  // что разобрал из строки, поэтому параметры TLS из неё вынуты.
  const adapter = new PrismaPg({ connectionString: url, ssl: opcoesTls() });
  client = new PrismaClient({ adapter });
  return client;
}

/**
 * Настройки TLS подключения к базе.
 *
 * Пул Supabase отдаёт сертификат, подписанный собственным корневым, — в
 * списке доверенных у Node его нет, и проверка обрывает соединение словами
 * «self-signed certificate in certificate chain». Соединение при этом даже
 * не начинается, и отказ выглядит как что угодно, кроме своей причины.
 *
 * Два honest пути, и выбор за настройкой:
 *
 * DATABASE_CA_CERT задан — проверяем цепочку по этому корневому. Это
 * полноценная защита: подменить сервер посередине нельзя.
 *
 * Не задан — соединение шифруется, но подлинность сервера не проверяется.
 * Ровно это и означает sslmode=require в libpq, и именно так Supabase
 * описывает подключение к пулу. Канал закрыт от чтения, но не от
 * посредника, который сумеет встать в середину, — поэтому в production об
 * этом говорится в журнале, а не замалчивается.
 */
function opcoesTls(): { ca?: string; rejectUnauthorized: boolean } {
  const config = loadConfig();
  const ca = config.database.caCert;

  if (ca) return { ca, rejectUnauthorized: true };

  if (config.isProduction && !avisouSobreTls) {
    avisouSobreTls = true;
    logger().warn(
      "DATABASE_CA_CERT не задан: соединение с базой шифруется, но подлинность сервера не проверяется.",
    );
  }

  return { rejectUnauthorized: false };
}

let avisouSobreTls = false;

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
