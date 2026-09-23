import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, RequestHandler } from "express";

import { loadConfig } from "../config/env";
import { parseBrazilianPhone } from "../utils/phone";

/**
 * Ограничение частоты (§46, §66).
 *
 * Хранилище по умолчанию — в памяти процесса. Для одного инстанса этого
 * достаточно, но при горизонтальном масштабировании лимит размажется по
 * инстансам: тогда сюда нужно подключить общее хранилище. Оставляю это
 * явным, чтобы лимит не считали более надёжным, чем он есть.
 */
function message(text: string) {
  return { error: text };
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
    message: message("Muitas requisições. Tente novamente em instantes."),
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
    message: message("Muitas tentativas. Aguarde antes de pedir um novo código."),
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
    message: message("Limite de análises atingido. Tente novamente mais tarde."),
  });
}
