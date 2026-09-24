import type { Request, Response } from "express";

import { limparMensagem } from "../boot/failureServer";
import { loadConfig } from "../config/env";
import { classifyError, statusDoErro } from "../errors/categories";
import { openAiClient } from "../ai/openai/client";
import { db, isDatabaseConfigured } from "../services/db";
import { logger } from "../utils/logger";

/**
 * Диагностика production (§41).
 *
 * Нужна потому, что снаружи видно только «не получилось», а изнутри — что
 * именно: нет ключа, отказал провайдер, недоступна база. Разница решает,
 * куда идти чинить, а по общему сообщению её не восстановить.
 *
 * Секретов отсюда не уходит никогда. Ключ показывается началом в три
 * символа и длиной — этого хватает, чтобы отличить «задан не тот ключ» от
 * «не задан вовсе», и не хватает ни для чего другого (§76).
 */

/** Начало ключа и длина — чтобы отличить «не тот» от «нет вовсе». */
function pistaDaChave(chave: string | undefined): string | null {
  if (!chave) return null;
  return `${chave.slice(0, 3)}…(${chave.length})`;
}

function mensagemDoErro(error: unknown): string {
  // Та же чистка, что и на странице отказа: в сообщении драйвера приезжает
  // строка подключения целиком, вместе с паролем.
  return limparMensagem(error);
}

/**
 * GET /health/ai — доходит ли запрос до провайдера.
 *
 * Делает настоящий, самый маленький запрос: без него проверка говорила бы
 * лишь о том, что переменные заданы, а это не то же самое, что «работает».
 * Текст пользователя сюда не попадает — только просьба ответить «OK».
 */
export async function ai(req: Request, res: Response): Promise<void> {
  const config = loadConfig();
  const chave = config.ai.openai.apiKey;

  const base = {
    provider: config.ai.provider,
    model: config.ai.openai.model ?? null,
    apiKeyConfigured: Boolean(chave),
    apiKeyPrefix: pistaDaChave(chave),
  };

  // ?live=0 — только настройки, без обращения к провайдеру. Живой вызов
  // стоит денег, и иногда нужно просто посмотреть, что задано.
  if (req.query.live === "0") {
    res.status(200).json({ ...base, openaiRequest: "skipped" });
    return;
  }

  if (config.ai.provider !== "openai") {
    res.status(200).json({
      ...base,
      openaiRequest: "skipped",
      errorCode: "AI_CONFIGURATION_ERROR",
      message: `AI_PROVIDER=${config.ai.provider}: OpenAI не выбран.`,
    });
    return;
  }

  if (!chave || !config.ai.openai.model) {
    res.status(200).json({
      ...base,
      openaiRequest: "error",
      status: null,
      errorCode: "AI_CONFIGURATION_ERROR",
      message: !chave ? "OPENAI_API_KEY не задан." : "OPENAI_MODEL не задан.",
    });
    return;
  }

  const comecou = Date.now();

  try {
    const resposta = await openAiClient().responses.create({
      model: config.ai.openai.model,
      instructions: "Responda exatamente com: OK",
      input: "ping",
      max_output_tokens: 16,
      store: false,
    });

    res.status(200).json({
      ...base,
      openaiRequest: "success",
      status: 200,
      latencyMs: Date.now() - comecou,
      outputPresent: typeof resposta.output_text === "string",
    });
  } catch (error) {
    const categoria = classifyError(error);
    const status = statusDoErro(error);

    logger().error(
      { categoria, status, err: error },
      "diagnóstico: chamada ao provedor de IA falhou",
    );

    res.status(200).json({
      ...base,
      openaiRequest: "error",
      status,
      latencyMs: Date.now() - comecou,
      errorCode: categoria,
      message: mensagemDoErro(error),
    });
  }
}

/** Маркер отката: проба записи ничего не оставляет в базе. */
const ROLLBACK = Symbol("rollback");

/**
 * GET /health/db — доходит ли до базы чтение и запись.
 *
 * Чтения мало: `select 1` проходит и тогда, когда запись невозможна, а дело
 * создаётся именно записью. Проба пишет настоящую строку тем же клиентом и
 * той же схемой, а затем откатывает транзакцию — в базе не остаётся ничего.
 */
export async function database(_req: Request, res: Response): Promise<void> {
  if (!isDatabaseConfigured()) {
    res.status(503).json({
      configured: false,
      read: "error",
      write: "skipped",
      errorCode: "DATABASE_ERROR",
      message: "Строка подключения не задана.",
    });
    return;
  }

  const leitura = await (async () => {
    const comecou = Date.now();
    try {
      await db().$queryRaw`select 1`;
      return { read: "success" as const, readLatencyMs: Date.now() - comecou };
    } catch (error) {
      return {
        read: "error" as const,
        readLatencyMs: Date.now() - comecou,
        message: mensagemDoErro(error),
      };
    }
  })();

  if (leitura.read === "error") {
    res.status(503).json({
      configured: true,
      ...leitura,
      write: "skipped",
      errorCode: "DATABASE_ERROR",
    });
    return;
  }

  const comecou = Date.now();

  try {
    await db().$transaction(async (tx) => {
      await tx.case.create({
        data: {
          publicId: `RB-DIAG${Date.now().toString(36).slice(-2).toUpperCase()}`,
          description: "sonda de diagnóstico — nunca persistida",
        },
      });
      throw ROLLBACK;
    });

    // Сюда не попадаем: транзакция обязана завершиться откатом.
    res.status(500).json({
      configured: true,
      ...leitura,
      write: "error",
      errorCode: "UNKNOWN_ERROR",
      message: "Проба записи не откатилась.",
    });
  } catch (error) {
    if (error === ROLLBACK) {
      res.status(200).json({
        configured: true,
        ...leitura,
        write: "success",
        writeLatencyMs: Date.now() - comecou,
      });
      return;
    }

    const categoria = classifyError(error);
    logger().error({ categoria, err: error }, "diagnóstico: escrita no banco falhou");

    res.status(503).json({
      configured: true,
      ...leitura,
      write: "error",
      writeLatencyMs: Date.now() - comecou,
      errorCode: categoria,
      message: mensagemDoErro(error),
    });
  }
}
