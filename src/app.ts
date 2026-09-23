import path from "node:path";

import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import pinoHttp from "pino-http";

import { loadConfig } from "./config/env";
import { attachAdmin } from "./middleware/adminSession";
import { attachSession } from "./middleware/session";
import { csrfProtection } from "./middleware/csrf";
import { errorHandler, notFound } from "./middleware/errors";
import { globalRateLimit } from "./middleware/rateLimit";
import { securityHeaders } from "./middleware/security";
import { uploadParser } from "./middleware/upload";
import { buildRouter } from "./routes";
import { logger } from "./utils/logger";
import { randomToken } from "./utils/crypto";
import { REDACTED_PATHS } from "./utils/logger";
import { VIEWS_ROOT } from "./utils/render";

const PUBLIC_ROOT = path.resolve(__dirname, "../public");

/**
 * Секрет подписи кук. В production его отсутствие уже отсекает loadConfig();
 * сюда попадает только dev. Случайный на каждый запуск, а не фиксированный:
 * фиксированная строка в коде рано или поздно уедет на стенд, и подписью
 * сессий станет публично известное значение.
 */
function resolveCookieSecret(): string {
  const config = loadConfig();
  if (config.session.secret) return config.session.secret;

  logger().warn(
    "SESSION_SECRET не задан — использую случайный секрет на время работы процесса. " +
      "Сессии не переживут перезапуск. Так можно только в разработке.",
  );
  return randomToken(32);
}

export function createApp(): Express {
  const config = loadConfig();
  const app = express();

  // Сколько прокси перед приложением — от этого зависит, какой адрес
  // считать адресом клиента при ограничении частоты.
  app.set("trust proxy", config.trustedProxyHops);
  app.set("view engine", "ejs");
  app.set("views", VIEWS_ROOT);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      logger: logger(),
      redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
      // Здоровье опрашивают часто — в логе от этого только шум.
      autoLogging: { ignore: (req) => req.url === "/health" },
    }),
  );

  app.use(securityHeaders());
  app.use(globalRateLimit());

  app.use(
    express.static(PUBLIC_ROOT, {
      maxAge: config.isProduction ? "7d" : 0,
      index: false,
      // Скрытые файлы не отдаются: в каталоге не должно оказаться .env,
      // но полагаться на это как на единственную защиту нельзя.
      dotfiles: "ignore",
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "128kb" }));
  // Порядок важен: multipart разбирается до CSRF, иначе тело запроса пустое
  // и любая загрузка файла выглядит как подделка (см. middleware/upload.ts).
  app.use(uploadParser());
  app.use(cookieParser(resolveCookieSecret()));
  app.use(csrfProtection());
  app.use(attachSession());
  app.use(attachAdmin());

  app.use(buildRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
