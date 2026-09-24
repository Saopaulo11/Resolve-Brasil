import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler, Response } from "express";

import { loadConfig } from "../config/env";
import { parseBrazilianPhone } from "../utils/phone";
import { renderPage } from "../utils/render";

/**
 * Ограничение частоты (§46, §66).
 *
 * Хранилище по умолчанию — в памяти процесса. Для одного инстанса этого
 * достаточно, но при горизонтальном масштабировании лимит размажется по
 * инстансам: тогда сюда нужно подключить общее хранилище. Оставляю это
 * явным, чтобы лимит не считали более надёжным, чем он есть.
 */
/**
 * Ответ при срабатывании лимита.
 *
 * Раньше отдавался JSON: человек, набравший телефон, видел вместо страницы
 * строку `{"error":"Muitas tentativas…"}` — без вёрстки, без пути назад и без
 * своего ввода. Сайт отрисовывается на сервере, и отказ должен выглядеть как
 * остальные его страницы.
 *
 * Заголовок 429 и RateLimit-* остаются: их читают не глазами.
 */
function paginaDeLimite(heading: string, text: string): RequestHandler {
  return function limiteAtingido(req: Request, res: Response) {
    res.status(429);

    try {
      renderPage(req, res, "erro", {
        title: `${heading} — Resolve Brasil`,
        description: text,
        heading,
        message: text,
      });
    } catch {
      // Макет мог не отрисоваться — тогда простой текст, но не JSON.
      res.type("text/plain").send(text);
    }
  };
}

/**
 * Ключ по адресу. Сырой IP как ключ бесполезен против IPv6: там у одного
 * абонента обычно целая /64, и он меняет адрес столько раз, сколько нужно.
 * ipKeyGenerator сводит адрес к подсети; для IPv4 это сам адрес.
 */
function addressKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** Общий потолок на весь трафик — защита от простого флуда. */
export function globalRateLimit(): RequestHandler {
  const config = loadConfig();
  return rateLimit({
    windowMs: 60_000,
    limit: config.rateLimits.globalPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: paginaDeLimite(
      "Muitas requisições",
      "Tente novamente em instantes.",
    ),
  });
}

/**
 * Отправка OTP. Лимит по номеру, а не по IP: иначе один мобильный оператор
 * за NAT заблокирует себе весь город, а перебор с разных IP пройдёт мимо.
 */
export function otpRequestRateLimit(): RequestHandler {
  const config = loadConfig();
  return rateLimit({
    windowMs: 60 * 60_000,
    limit: config.rateLimits.otpPerPhonePerHour,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Номер приводится к единому виду: иначе «11987654321»,
      // «+5511987654321» и «(11) 98765-4321» получат по своей корзине,
      // и лимит обходится одной запятой в поле ввода.
      const phone = (req.body as Record<string, unknown> | undefined)?.phone;
      if (typeof phone !== "string" || phone.length === 0) return addressKey(req);

      const parsed = parseBrazilianPhone(phone);
      return parsed.ok ? `phone:${parsed.e164}` : addressKey(req);
    },
    /**
     * Неразобранный номер не тратит бюджет.
     *
     * Лимит нужен, чтобы не рассылать коды, а не чтобы наказывать за
     * опечатку. Раньше неверный номер уходил в корзину по адресу, и человек,
     * трижды промахнувшийся в поле, оказывался заблокирован, не получив ни
     * одного кода. На общем выходном адресе — а у бессерверной платформы он
     * общий — так блокировались бы и посторонние.
     *
     * Поток при этом не остаётся без защиты: общий лимит на минуту считает
     * все запросы подряд, включая эти.
     */
    skip: (req) => {
      const phone = (req.body as Record<string, unknown> | undefined)?.phone;
      if (typeof phone !== "string") return true;
      return !parseBrazilianPhone(phone).ok;
    },
    // И не считаем попытки, которые до отправки кода не дошли.
    skipFailedRequests: true,
    handler: paginaDeLimite(
      "Muitas tentativas",
      "Aguarde alguns minutos antes de pedir um novo código.",
    ),
  });
}

/** Вызовы AI: дороже всего и первыми страдают от злоупотребления (§46). */
export function aiRateLimit(): RequestHandler {
  const config = loadConfig();
  return rateLimit({
    windowMs: 60 * 60_000,
    limit: config.rateLimits.aiPerUserPerHour,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => req.session?.userId ?? addressKey(req),
    handler: paginaDeLimite(
      "Limite de análises atingido",
      "Você já fez várias análises nesta hora. Tente novamente mais tarde.",
    ),
  });
}
