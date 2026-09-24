import { AiError } from "../ai/openai/client";

/**
 * Категория отказа для журнала (§41).
 *
 * Человеку показывается одно спокойное сообщение — ему незачем разбирать,
 * чем просроченный ключ отличается от превышенного лимита. Но в журнале
 * разница решает всё: «не удалось» одинаково выглядит и когда кончились
 * деньги у провайдера, и когда недоступна база, а чинится это совершенно
 * по-разному.
 */
export type ErrorCategory =
  | "AI_CONFIGURATION_ERROR"
  | "AI_AUTH_ERROR"
  | "AI_RATE_LIMIT_ERROR"
  | "AI_PROVIDER_ERROR"
  | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE"
  | "AI_SCHEMA_VALIDATION_ERROR"
  | "DOCUMENT_UPLOAD_ERROR"
  | "DOCUMENT_PROCESSING_ERROR"
  | "DATABASE_ERROR"
  | "UNKNOWN_ERROR";

/** Коды разбора ответа модели — это наша обработка, а не отказ провайдера. */
const POR_CODIGO_AI: Record<string, ErrorCategory> = {
  SEM_CHAVE: "AI_CONFIGURATION_ERROR",
  SEM_MODELO: "AI_CONFIGURATION_ERROR",
  PROVEDOR_FALHOU: "AI_PROVIDER_ERROR",
  RESPOSTA_VAZIA: "AI_INVALID_RESPONSE",
  RESPOSTA_TRUNCADA: "AI_INVALID_RESPONSE",
  JSON_INVALIDO: "AI_INVALID_RESPONSE",
  ESQUEMA_INVALIDO: "AI_SCHEMA_VALIDATION_ERROR",
};

/** Ответ провайдера по коду HTTP. */
export function categoriaPorStatus(status: number): ErrorCategory {
  if (status === 401 || status === 403) return "AI_AUTH_ERROR";
  if (status === 429) return "AI_RATE_LIMIT_ERROR";
  if (status === 408 || status === 504) return "AI_TIMEOUT";
  return "AI_PROVIDER_ERROR";
}

function comoObjeto(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? (error as Record<string, unknown>) : {};
}

/** Код HTTP из ошибки SDK, если он там есть. */
export function statusDoErro(error: unknown): number | null {
  const bruto = comoObjeto(error).status ?? comoObjeto(comoObjeto(error).cause).status;
  return typeof bruto === "number" ? bruto : null;
}

/**
 * Имя ошибки Prisma — по строке, а не по классу.
 *
 * Классы приезжают из сгенерированного клиента, и импорт ради instanceof
 * привязал бы разбор ошибок к генерации. Имя у них стабильное.
 */
function ehDeBanco(error: unknown): boolean {
  const nome = comoObjeto(error).name;
  return typeof nome === "string" && nome.startsWith("PrismaClient");
}

export function classifyError(error: unknown): ErrorCategory {
  if (error instanceof AiError) {
    // Отказ провайдера уточняется кодом HTTP: 401 и 429 — разные беды, и
    // «провайдер не ответил» для обеих одинаково бесполезно.
    if (error.code === "PROVEDOR_FALHOU") {
      const status = statusDoErro(error.cause);
      if (status !== null) return categoriaPorStatus(status);

      const nome = comoObjeto(error.cause).name;
      if (typeof nome === "string" && /Timeout|Connection/i.test(nome)) {
        return "AI_TIMEOUT";
      }
    }

    return POR_CODIGO_AI[error.code] ?? "AI_PROVIDER_ERROR";
  }

  if (ehDeBanco(error)) return "DATABASE_ERROR";

  const status = statusDoErro(error);
  if (status !== null) return categoriaPorStatus(status);

  return "UNKNOWN_ERROR";
}
