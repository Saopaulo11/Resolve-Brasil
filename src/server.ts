// Загрузка .env идёт до всего остального: config/env.ts читает process.env
// на первом же обращении, и опоздавший dotenv не успел бы ничего дать.
//
// Файл не обязателен: в production переменные приходят от платформы, и .env
// там нет вовсе. dotenv не перезаписывает то, что уже задано в окружении,
// поэтому боевые значения он подменить не может (§78).
import { config as loadDotenv } from "dotenv";

loadDotenv();

import { createApp } from "./app";
import { loadConfig } from "./config/env";
import { disconnectDb } from "./services/db";
import { logger } from "./utils/logger";

/**
 * Точка входа. Конфигурация читается первой: если в production не хватает
 * обязательного, процесс обязан упасть здесь, а не обслуживать запросы с
 * небезопасными умолчаниями.
 */
function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // Логгер сам зависит от конфигурации, поэтому здесь ещё console.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
    return;
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger().info(
      { port: config.port, env: config.nodeEnv, aiProvider: config.ai.provider },
      "Resolve Brasil no ar",
    );
  });

  // Корректное завершение: без него платформа убивает процесс на середине
  // запроса, а соединения к базе остаются висеть.
  const shutdown = (signal: string) => {
    logger().info({ signal }, "encerrando");
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    // Если за 10 секунд не закрылись — выходим принудительно.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
