import helmet from "helmet";
import type { RequestHandler } from "express";

import { loadConfig } from "../config/env";

/**
 * Заголовки безопасности (§66).
 *
 * CSP намеренно строгая и без 'unsafe-inline': интерфейс рендерится на
 * сервере, скрипты и стили лежат отдельными файлами (§68). Как только
 * появится инлайновый <script>, эта политика его заблокирует — и это
 * правильное поведение, а не повод ослабить политику.
 */
export function securityHeaders(): RequestHandler {
  const config = loadConfig();

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        /*
         * blob: — предпросмотр вложения до отправки.
         *
         * Миниатюру выбранного снимка браузер отдаёт как blob:-ссылку, и
         * создаёт её наш же скрипт из файла, который человек только что
         * выбрал. Со стороны такую ссылку не подставить: чтобы её получить,
         * нужно уже выполнять скрипт на этой странице, а это запрещает
         * script-src. Данные при этом никуда не уходят — blob живёт в
         * памяти вкладки.
         */
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        // Документы и запросы уходят только на свой же origin.
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // null, а не отсутствие ключа: helmet добавляет эту директиву по
        // умолчанию, и «не указать» её недостаточно, чтобы выключить.
        // Локально по http она мешала бы отлаживать стенд.
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    // Ссылки на сторонние сайты (gov.br и прочие) не должны утаскивать
    // полный путь: в нём бывает публичный номер дела.
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  });
}
