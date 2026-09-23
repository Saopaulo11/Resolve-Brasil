import { loadConfig } from "../config/env";
import { stores } from "../users/storeRegistry";
import type { AnalyticsCaseRow } from "./analyticsStore";

/**
 * Агрегация с защитой малых групп (§57, §58).
 *
 * Удаления телефона и email недостаточно, чтобы считать данные
 * обезличенными. Сегмент из трёх наблюдений — «дела по компании X в городе
 * Y за март на сумму 300–500» — опознаёт человека не хуже имени. Поэтому
 * группа меньше порога не показывается вообще: ни её значение, ни её
 * название.
 */
export type Bucket = {
  key: string;
  count: number;
};

export type GroupedResult = {
  buckets: Bucket[];
  /** Сколько групп скрыто как слишком малые. */
  suppressedGroups: number;
  /** Сколько наблюдений в них. Без этого сумма по группам не сходится. */
  suppressedCount: number;
  minGroupSize: number;
};

/**
 * Группировка с подавлением.
 *
 * Скрытые группы не молчат: их число и суммарный объём возвращаются рядом.
 * Иначе читатель отчёта решит, что видит всё, и сложит доли до ста
 * процентов там, где это неверно.
 */
export function groupWithSuppression(
  rows: AnalyticsCaseRow[],
  keyOf: (row: AnalyticsCaseRow) => string | null,
  minGroupSize: number,
): GroupedResult {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: Bucket[] = [];
  let suppressedGroups = 0;
  let suppressedCount = 0;

  for (const [key, count] of counts) {
    if (count < minGroupSize) {
      suppressedGroups += 1;
      suppressedCount += count;
      continue;
    }
    buckets.push({ key, count });
  }

  buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return { buckets, suppressedGroups, suppressedCount, minGroupSize };
}

export type Summary = {
  /** Общее число дел. Не сегмент — подавлению не подлежит. */
  total: number;
  resolved: number;
  unresolved: number;
  escalated: number;
  /** Доля эскалаций, 0–1. null, когда дел слишком мало для доли. */
  escalationRate: number | null;
  /** Медиана дней до решения. null, если решённых слишком мало. */
  medianResolutionDays: number | null;
};

const RESOLVED: ReadonlySet<string> = new Set(["RESOLVIDO"]);
const CLOSED: ReadonlySet<string> = new Set(["RESOLVIDO", "ENCERRADO"]);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return null;
  return Math.round((left + right) / 2);
}

export function summarize(rows: AnalyticsCaseRow[], minGroupSize: number): Summary {
  const resolved = rows.filter((row) => RESOLVED.has(row.resolutionStatus)).length;
  const escalated = rows.filter((row) => row.escalationLevel !== "NENHUM").length;

  const days = rows
    .filter((row) => CLOSED.has(row.resolutionStatus) && row.resolutionDays !== null)
    .map((row) => row.resolutionDays as number);

  return {
    total: rows.length,
    resolved,
    unresolved: rows.length - resolved,
    escalated,
    // Доля на крошечной выборке вводит в заблуждение сильнее, чем её отсутствие.
    escalationRate: rows.length >= minGroupSize ? escalated / rows.length : null,
    medianResolutionDays: days.length >= minGroupSize ? median(days) : null,
  };
}

export type InternalReport = {
  generatedAt: string;
  minGroupSize: number;
  summary: Summary;
  byCategory: GroupedResult;
  byIndustry: GroupedResult;
  byPaymentMethod: GroupedResult;
  byAmountBucket: GroupedResult;
  byMonth: GroupedResult;
  byState: GroupedResult;
};

/** Внутренний отчёт (§58). Демонстрационные дела в него не входят (§82). */
export async function internalReport(): Promise<InternalReport> {
  const minGroupSize = loadConfig().analytics.minGroupSize;
  const rows = await stores().analytics.listReal();

  return {
    generatedAt: new Date().toISOString(),
    minGroupSize,
    summary: summarize(rows, minGroupSize),
    byCategory: groupWithSuppression(rows, (row) => row.category, minGroupSize),
    byIndustry: groupWithSuppression(rows, (row) => row.industry, minGroupSize),
    byPaymentMethod: groupWithSuppression(rows, (row) => row.paymentMethod, minGroupSize),
    byAmountBucket: groupWithSuppression(rows, (row) => row.amountBucket, minGroupSize),
    byMonth: groupWithSuppression(rows, (row) => row.month, minGroupSize),
    byState: groupWithSuppression(rows, (row) => row.state, minGroupSize),
  };
}

export type CompanyProfile = {
  company: string;
  /** §59: период и размер выборки показываются всегда. */
  period: { from: string; to: string } | null;
  sampleSize: number;
  available: boolean;
  reason: string | null;
  byCategory: GroupedResult | null;
  medianResolutionDays: number | null;
};

/**
 * Срез по компании (§59).
 *
 * Возвращается только при достаточной выборке. Рейтингов «худшие компании
 * Бразилии» здесь нет и не будет: у нас не репрезентативная выборка по
 * стране, а дела, которые к нам пришли, — и подавать их как рейтинг значит
 * утверждать то, чего мы не знаем (§61).
 */
export async function companyProfile(companyNormalized: string): Promise<CompanyProfile> {
  const minGroupSize = loadConfig().analytics.minGroupSize;
  const all = await stores().analytics.listReal();
  const rows = all.filter((row) => row.companyNormalized === companyNormalized);

  if (rows.length < minGroupSize) {
    return {
      company: companyNormalized,
      period: null,
      sampleSize: rows.length,
      available: false,
      reason:
        `Amostra insuficiente: menos de ${minGroupSize} casos registrados. ` +
        "Nenhum dado é exibido para proteger quem registrou.",
      byCategory: null,
      medianResolutionDays: null,
    };
  }

  const months = rows.map((row) => row.month).sort();
  const days = rows
    .filter((row) => CLOSED.has(row.resolutionStatus) && row.resolutionDays !== null)
    .map((row) => row.resolutionDays as number);

  return {
    company: companyNormalized,
    period: { from: months[0] ?? "", to: months[months.length - 1] ?? "" },
    sampleSize: rows.length,
    available: true,
    reason: null,
    byCategory: groupWithSuppression(rows, (row) => row.category, minGroupSize),
    medianResolutionDays: days.length >= minGroupSize ? median(days) : null,
  };
}

export { median };
