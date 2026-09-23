import OpenAI from "openai";
import type { z } from "zod";

import { loadConfig } from "../../config/env";
import { logger } from "../../utils/logger";
import type { AiCallMeta } from "../providers/AIProvider";
import { jsonSchemaFormat } from "./jsonSchema";

/**
 * Единственная точка обращения к OpenAI (§41, §42).
 *
 * Ключ существует только здесь и только на сервере. Он не попадает в
 * бандл браузера, в шаблоны, в логи и в учёт вызовов.
 */

/**
 * Минимальный контракт того, чем мы пользуемся из SDK.
 *
 * Нужен для тестов: подменить этот объект куда честнее, чем мокать весь
 * пакет. Заодно видно, насколько узкая у нас зависимость от провайдера.
 */
export type ResponsesLike = {
  responses: {
    create(body: Record<string, unknown>): Promise<{
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number } | null;
      incomplete_details?: { reason?: string } | null;
      status?: string;
    }>;
  };
};

export type AiErrorCode =
  | "SEM_CHAVE"
  | "SEM_MODELO"
  | "PROVEDOR_FALHOU"
  | "RESPOSTA_VAZIA"
  | "RESPOSTA_TRUNCADA"
  | "JSON_INVALIDO"
  | "ESQUEMA_INVALIDO";

export class AiError extends Error {
  /**
   * Метрика неудачного вызова. Неудачи учитываются наравне с удачами (§45):
   * по одним успехам не видно ни доли отказов, ни их причины.
   */
  meta?: AiCallMeta;

  constructor(
    readonly code: AiErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiError";
  }

  withMeta(meta: AiCallMeta): this {
    this.meta = meta;
    return this;
  }
}

let client: ResponsesLike | null = null;

export function openAiClient(): ResponsesLike {
  if (client) return client;

  const config = loadConfig();
  if (!config.ai.openai.apiKey) {
    throw new AiError("SEM_CHAVE", "OPENAI_API_KEY не задан.");
  }

  client = new OpenAI({
    apiKey: config.ai.openai.apiKey,
    // Таймаут и повторы — на стороне SDK: свой цикл повторов здесь только
    // продублировал бы их и сломал учёт времени.
    timeout: config.ai.requestTimeoutMs,
    maxRetries: config.ai.maxRetries,
  }) as unknown as ResponsesLike;

  return client;
}

/** Для тестов: подставить клиент, не ходящий в сеть. */
export function setOpenAiClient(custom: ResponsesLike | null): void {
  client = custom;
}

export type StructuredCall<T> = {
  operation: string;
  promptVersion: string;
  schemaName: string;
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
};

export type StructuredResult<T> = {
  data: T;
  meta: AiCallMeta;
};

/**
 * Запрос со структурированным ответом (§8).
 *
 * Ответ модели не возвращается наружу как есть: сначала JSON, потом схема.
 * Неизвестное поле или неверный тип — это ошибка обработки, а не повод
 * показать «как есть»: иначе галлюцинация доедет до интерфейса и будет
 * выглядеть подтверждённым фактом.
 */
export async function runStructured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const config = loadConfig();
  const model = config.ai.openai.model;
  if (!model) throw new AiError("SEM_MODELO", "OPENAI_MODEL не задан.");

  const startedAt = Date.now();

  const meta = (success: boolean, errorCode: AiErrorCode | null, usage?: {
    input_tokens?: number;
    output_tokens?: number;
  } | null): AiCallMeta => ({
    provider: "openai",
    model,
    operation: call.operation,
    promptVersion: call.promptVersion,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    latencyMs: Date.now() - startedAt,
    success,
    errorCode,
  });

  let response: Awaited<ReturnType<ResponsesLike["responses"]["create"]>>;

  try {
    response = await openAiClient().responses.create({
      model,
      instructions: call.instructions,
      input: call.input,
      text: { format: jsonSchemaFormat(call.schemaName, call.schema) },
      max_output_tokens: config.ai.maxOutputTokens,
      // Переписка пользователя не остаётся на стороне провайдера (§47, §91):
      // источник правды — наша база, а не история у OpenAI.
      store: false,
    });
  } catch (cause) {
    logger().error(
      { operation: call.operation, err: cause },
      "chamada ao provedor de IA falhou",
    );
    throw new AiError("PROVEDOR_FALHOU", "Provedor de IA não respondeu.", cause).withMeta(
      meta(false, "PROVEDOR_FALHOU"),
    );
  }

  // Обрыв по лимиту токенов даёт синтаксически битый JSON. Отличить это от
  // настоящей ошибки формата важно: лечится оно увеличением лимита.
  if (response.incomplete_details?.reason === "max_output_tokens") {
    throw new AiError(
      "RESPOSTA_TRUNCADA",
      "Ответ модели обрезан лимитом токенов.",
    ).withMeta(meta(false, "RESPOSTA_TRUNCADA", response.usage));
  }

  const text = response.output_text;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AiError("RESPOSTA_VAZIA", "Модель вернула пустой ответ.").withMeta(
      meta(false, "RESPOSTA_VAZIA", response.usage),
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new AiError(
      "JSON_INVALIDO",
      "Ответ модели не разбирается как JSON.",
      cause,
    ).withMeta(meta(false, "JSON_INVALIDO", response.usage));
  }

  const parsed = call.schema.safeParse(raw);
  if (!parsed.success) {
    logger().error(
      { operation: call.operation, issues: parsed.error.issues.length },
      "resposta da IA não passou na validação de esquema",
    );
    throw new AiError(
      "ESQUEMA_INVALIDO",
      "Ответ модели не соответствует схеме.",
      parsed.error,
    ).withMeta(meta(false, "ESQUEMA_INVALIDO", response.usage));
  }

  return { data: parsed.data, meta: meta(true, null, response.usage) };
}

export { jsonSchemaFormat };
