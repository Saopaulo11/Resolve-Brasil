import { db } from "../services/db";
import type { AnalyticsProjection } from "./projection";

/**
 * Аналитическое хранилище (§55).
 *
 * Отдельное от операционного намеренно: у будущего B2B-продукта не должно
 * быть пути к таблицам с персональными данными. Связи с cases и users здесь
 * нет — только псевдоним дела.
 */
export type AnalyticsCaseRow = AnalyticsProjection & { createdAt: Date };

export interface AnalyticsStore {
  /** Обновляет слепок дела или создаёт его. Дублей не плодит. */
  upsert(projection: AnalyticsProjection): Promise<void>;
  /** Все слепки, кроме демонстрационных (§82). */
  listReal(): Promise<AnalyticsCaseRow[]>;
  countAll(): Promise<number>;
}

export class PrismaAnalyticsStore implements AnalyticsStore {
  async upsert(projection: AnalyticsProjection): Promise<void> {
    const { caseKey, ...rest } = projection;
    await db().analyticsCase.upsert({
      where: { caseKey },
      update: { ...rest, source: "AI_SUGGESTION" },
      create: { caseKey, ...rest, source: "AI_SUGGESTION" },
    });
  }

  async listReal(): Promise<AnalyticsCaseRow[]> {
    const rows = await db().analyticsCase.findMany({ where: { isDemo: false } });
    return rows as unknown as AnalyticsCaseRow[];
  }

  async countAll(): Promise<number> {
    return db().analyticsCase.count();
  }
}
