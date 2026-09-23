import pino from "pino";

import { loadConfig } from "../config/env";

/**
 * Логирование (§76).
 *
 * Правило одно: в логи не попадают полный телефон, CPF, содержимое
 * документов и переписки. Поэтому здесь не просто `pino()`, а pino с
 * redact-списком — иначе достаточно одного `logger.info({ user })`, чтобы
 * персональные данные утекли в лог-хранилище навсегда.
 */
const REDACTED_PATHS = [
  "phone",
  "*.phone",
  "*.*.phone",
  "cpf",
  "*.cpf",
  "*.*.cpf",
  "email",
  "*.email",
  "password",
  "*.password",
  "token",
  "*.token",
  "otp",
  "*.otp",
  "code",
  "*.code",
  "apiKey",
  "*.apiKey",
  "authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "content",
  "*.content",
  "description",
  "*.description",
];

function createLogger() {
  const config = loadConfig();

  // В тестах лог выключен: иначе вывод тестов тонет в строках запросов и
  // настоящая ошибка теряется среди них. LOG_LEVEL перебивает это решение.
  const defaultLevel =
    config.nodeEnv === "test" ? "silent" : config.isProduction ? "info" : "debug";

  return pino({
    level: process.env.LOG_LEVEL ?? defaultLevel,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    base: { env: config.nodeEnv },
  });
}

let instance: pino.Logger | null = null;

export function logger(): pino.Logger {
  if (!instance) instance = createLogger();
  return instance;
}

/**
 * Телефон для логов и интерфейса: +55 (11) *****-1234.
 * Полный номер не должен попадать ни в лог, ни в аналитику.
 */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export { REDACTED_PATHS };
