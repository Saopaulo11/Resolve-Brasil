import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

import { loadConfig } from "../config/env";

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
      const phone = (req.body as Record<string, unknown> | undefined)?.phone;
      return typeof phone === "string" && phone.length > 0 ? `phone:${phone}` : `ip:${req.ip}`;
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
    keyGenerator: (req) => req.session?.userId ?? `ip:${req.ip}`,
    message: message("Limite de análises atingido. Tente novamente mais tarde."),
  });
}
