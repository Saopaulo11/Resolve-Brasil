import type { AnalyticsCaseRow, AnalyticsStore } from "./analyticsStore";
import type { AnalyticsProjection } from "./projection";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 */
export class MemoryAnalyticsStore implements AnalyticsStore {
  private readonly rows = new Map<string, AnalyticsCaseRow>();

  async upsert(projection: AnalyticsProjection): Promise<void> {
    const existing = this.rows.get(projection.caseKey);
    this.rows.set(projection.caseKey, {
      ...projection,
      createdAt: existing?.createdAt ?? new Date(),
    });
  }

  async listReal(): Promise<AnalyticsCaseRow[]> {
    return [...this.rows.values()].filter((row) => !row.isDemo);
  }

  async countAll(): Promise<number> {
    return this.rows.size;
  }

  /** Только для тестов: увидеть всё, включая демонстрационное. */
  listEverything(): AnalyticsCaseRow[] {
    return [...this.rows.values()];
  }
}
