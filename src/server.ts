// Загрузка .env идёт до всего остального: config/env.ts читает process.env
// на первом же обращении, и опоздавший dotenv не успел бы ничего дать.
//
// Файл не обязателен: в production переменные приходят от платформы, и .env
// там нет вовсе. dotenv не перезаписывает то, что уже задано в окружении,
// поэтому боевые значения он подменить не может (§78).
import { config as loadDotenv } from "dotenv";

loadDotenv();

import { createApp } from "./app";
import { startFailureServer } from "./boot/failureServer";
import { loadConfig } from "./config/env";
import { disconnectDb } from "./services/db";
import { logger } from "./utils/logger";

/**
 * Точка входа. Конфигурация читается первой: если чего-то обязательного не
 * хватает, приложение не поднимается вовсе — обслуживать запросы с
 * небезопасными умолчаниями оно не должно. Что делать со сбоем дальше,
 * решает обработчик внизу файла.
 */
function main(): void {
  const config = loadConfig();
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

try {
  main();
} catch (error) {
  // В production упавший процесс не оставляет наружу ничего, кроме заглушки
  // платформы: по ней не отличить нехватку переменной от сломанного модуля.
  // Поэтому здесь вместо смерти поднимается сервер, который причину называет.
  //
  // В разработке — наоборот: процесс обязан упасть шумно. Сервер, тихо
  // отвечающий 503, разработчик заметит не сразу, а упавшую команду — сразу.
  console.error(error);
  if (process.env.NODE_ENV === "production") {
    startFailureServer(error);
  } else {
    throw error;
  }
}
