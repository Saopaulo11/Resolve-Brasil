import { randomUUID } from "node:crypto";

import type { AiProvider } from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Учёт вызовов модели как хранилище (§45, §50).
 *
 * Запись здесь — только метрика: провайдер, модель, операция, токены, время,
 * успех. Ни текста запроса, ни ответа, ни ключа. Это не осторожность ради
 * осторожности: таблица учёта с содержимым запросов — это вторая копия
 * переписки пользователя, которую никто не собирался хранить.
 */
export type AiRequestRow = {
  id: string;
  provider: AiProvider;
  model: string;
  operation: string;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  latencyMs: number | null;
  success: boolean;
  errorCode: string | null;
  createdAt: Date;
};

export type CreateAiRequestInput = Omit<AiRequestRow, "id" | "createdAt">;

export type AiUsageTotals = {
  chamadas: number;
  falhas: number;
  inputTokens: number;
  outputTokens: number;
  /** null — если цены не заданы в конфигурации. Придуманная цифра хуже пустоты. */
  custo: number | null;
  latenciaMediaMs: number | null;
};

export interface AiRequestStore {
  create(input: CreateAiRequestInput): Promise<AiRequestRow>;
  listRecent(limit: number): Promise<AiRequestRow[]>;
  /** Итоги по последним записям — без разбивки по пользователям (§56). */
  totals(since: Date): Promise<AiUsageTotals>;
}

function summarize(rows: AiRequestRow[]): AiUsageTotals {
  const withCost = rows.filter((row) => row.estimatedCost !== null);
  const withLatency = rows.filter((row) => row.latencyMs !== null);

  return {
    chamadas: rows.length,
    falhas: rows.filter((row) => !row.success).length,
    inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    custo:
      withCost.length === 0
        ? null
        : Number(
            withCost.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0).toFixed(6),
          ),
    latenciaMediaMs:
      withLatency.length === 0
        ? null
        : Math.round(
            withLatency.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) /
              withLatency.length,
          ),
  };
}

function toRow(row: {
  id: string;
  provider: AiProvider;
  model: string;
  operation: string;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: unknown;
  latencyMs: number | null;
  success: boolean;
  errorCode: string | null;
  createdAt: Date;
}): AiRequestRow {
  return {
    ...row,
    // Decimal приходит объектом Prisma; в интерфейсе нужен обычный number.
    estimatedCost: row.estimatedCost === null ? null : Number(row.estimatedCost),
  };
}

export class PrismaAiRequestStore implements AiRequestStore {
  async create(input: CreateAiRequestInput): Promise<AiRequestRow> {
    const row = await db().aiRequest.create({ data: input });
    return toRow(row);
  }

  async listRecent(limit: number): Promise<AiRequestRow[]> {
    const rows = await db().aiRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toRow);
  }

  async totals(since: Date): Promise<AiUsageTotals> {
    const rows = await db().aiRequest.findMany({
      where: { createdAt: { gte: since } },
    });
    return summarize(rows.map(toRow));
  }
}

/** MOCK / DEVELOPMENT ONLY (§79). */
export class MemoryAiRequestStore implements AiRequestStore {
  readonly all: AiRequestRow[] = [];

  async create(input: CreateAiRequestInput): Promise<AiRequestRow> {
    const row: AiRequestRow = { ...input, id: randomUUID(), createdAt: new Date() };
    this.all.push(row);
    return row;
  }

  async listRecent(limit: number): Promise<AiRequestRow[]> {
    return [...this.all]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async totals(since: Date): Promise<AiUsageTotals> {
    return summarize(
      this.all.filter((row) => row.createdAt.getTime() >= since.getTime()),
    );
  }
}

export { summarize as summarizeAiUsage };
