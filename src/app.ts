/**
 * Сборка Express-приложения.
 */
import path from "node:path";

import cookieParser from "cookie-parser";
import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import pinoHttp from "pino-http";

import { corpoDaFalha } from "./boot/failureServer";
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

/**
 * Отдать разбор кук cookie-parser, даже если его уже сделали за нас.
 *
 * Хостинг отдаёт запрос приложению не сырым: его адаптер кое-что разбирает
 * заранее и кладёт в запрос готовое `cookies`. А cookie-parser начинается со
 * строки `if (req.cookies) return next()` — увидев готовое поле, он не делает
 * ничего, и вместе с ним не появляется ни `req.secret`, ни `req.signedCookies`.
 *
 * Дальше всё рушится молча: подписанная кука не читается никогда, а первая же
 * попытка её записать бросает «cookieParser("secret") required for signed
 * cookies». На стенде это выглядело так: дело в базе создавалось, вложения
 * прикреплялись, а человек получал «Algo deu errado» — обрыв приходился ровно
 * на куку с номером дела. Локально не воспроизводилось никогда: там перед
 * Express никого нет.
 *
 * Поэтому готовый разбор отбрасывается. Ничего не теряется: источник правды —
 * заголовок Cookie, и cookie-parser разбирает его сам, заодно проверяя подписи.
 */
function exigirAnaliseDasCookies(): RequestHandler {
  return function cookiesCruas(req, _res, next) {
    // Через запись, а не через Request: в типах Express `cookies` обязательное
    // поле, и удалить его иначе нельзя.
    const campos = req as unknown as Record<string, unknown>;
    if (campos.cookies) delete campos.cookies;
    next();
  };
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

  /*
   * Service worker — своим маршрутом, до раздачи статики.
   *
   * Статика в production отдаётся с недельным сроком жизни, а этому файлу
   * долгий срок противопоказан: пока браузер держит старую копию, он живёт
   * по старым правилам. Современные браузеры и так берут скрипт воркера
   * мимо HTTP-кэша, но полагаться на это не стоит — цена ошибки здесь
   * недельная, и она на чужом устройстве.
   */
  app.get("/sw.js", (_req, res) => {
    res.sendFile(path.join(PUBLIC_ROOT, "sw.js"), {
      headers: {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-cache",
        // Область — весь сайт: иначе воркер обслуживал бы только /sw.js.
        "service-worker-allowed": "/",
      },
    });
  });

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
  app.use(exigirAnaliseDasCookies());
  app.use(cookieParser(resolveCookieSecret()));
  app.use(csrfProtection());
  app.use(attachSession());
  app.use(attachAdmin());

  app.use(buildRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * Экспорт по умолчанию — для платформы, и только для неё.
 *
 * Vercel выбирает точку входа сам: из файлов с известными именами
 * (server.js, src/server.ts, src/app.ts) он берёт тот, который импортирует
 * express, и ждёт оттуда приложение или функцию-обработчик в экспорте по
 * умолчанию. Обоим условиям отвечает только этот файл — отсюда и место
 * обёртки. Сборка без неё падает с «No entrypoint found which imports
 * express», а с ней, но без экспорта по умолчанию, собирается зелёной и
 * отвечает пятисоткой на каждый запрос: «Invalid export found in module».
 *
 * Приложение строится при первом запросе, а не при импорте: тесты
 * импортируют createApp и собирают своё, и лишний экземпляр на каждый
 * импорт им только мешал бы.
 */
let instancia: Express | null = null;

export default function handler(req: Request, res: Response): void {
  if (!instancia) {
    try {
      instancia = createApp();
    } catch (error) {
      // Иначе причина сбоя остаётся внутри, а наружу уходит одна и та же
      // заглушка платформы — одинаковая для любой поломки.
      //
      // Здесь console, а не logger(): логгер сам читает конфигурацию, и на
      // сломанной конфигурации упал бы прямо в этом обработчике.
      console.error(error);
      res.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(corpoDaFalha(error));
      return;
    }
  }

  instancia(req, res);
}
