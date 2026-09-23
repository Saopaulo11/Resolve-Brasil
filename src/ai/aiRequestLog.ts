import { loadConfig } from "../config/env";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import type { AiCallMeta } from "./providers/AIProvider";

/**
 * Учёт вызовов модели (§45).
 *
 * Записывается только метрика: провайдер, модель, операция, токены, время,
 * успех. Ни текста запроса, ни ответа, ни ключей — это и не нужно для учёта,
 * а хранение содержимого превратило бы таблицу учёта в копию переписки.
 */
export type AiRequestRecord = AiCallMeta & { estimatedCost: number | null };

/**
 * Оценка стоимости. Цены берутся из конфигурации; не заданы — null.
 * Придуманная цифра выглядит достоверной, и это хуже пустоты.
 */
export function estimateCost(
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const { pricing } = loadConfig().ai;
  if (pricing.inputPerMillion === null || pricing.outputPerMillion === null) return null;
  if (inputTokens === null && outputTokens === null) return null;

  const input = ((inputTokens ?? 0) / 1_000_000) * pricing.inputPerMillion;
  const output = ((outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillion;
  return Number((input + output).toFixed(6));
}

const PROVIDER_MAP = {
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  mock: "MOCK",
} as const;

/** Запись о вызове. Возвращает id, чтобы связать её с сообщением. */
export async function recordAiRequest(meta: AiCallMeta): Promise<string | null> {
  try {
    const created = await stores().aiRequests.create({
      provider: PROVIDER_MAP[meta.provider],
      model: meta.model,
      operation: meta.operation,
      promptVersion: meta.promptVersion,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      estimatedCost: estimateCost(meta.inputTokens, meta.outputTokens),
      latencyMs: meta.latencyMs,
      success: meta.success,
      errorCode: meta.errorCode,
    });
    return created.id;
  } catch (error) {
    // Учёт не имеет права ломать пользовательский сценарий.
    logger().warn({ err: error, operation: meta.operation }, "falha ao registrar chamada de IA");
    return null;
  }
}
