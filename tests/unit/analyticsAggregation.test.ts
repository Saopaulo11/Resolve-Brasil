import { describe, expect, it } from "vitest";

import type { AnalyticsCaseRow } from "../../src/analytics/analyticsStore";
import { groupWithSuppression, median, summarize } from "../../src/analytics/aggregation";

function row(overrides: Partial<AnalyticsCaseRow> = {}): AnalyticsCaseRow {
  return {
    caseKey: Math.random().toString(36).slice(2),
    month: "2026-09",
    state: "SP",
    cityBucket: null,
    category: "PRODUTO_NAO_RECEBIDO",
    subcategory: null,
    industry: "ECOMMERCE",
    companyNormalized: "loja-exemplo",
    amountBucket: "200-500",
    paymentMethod: "PIX",
    resolutionStatus: "NOVO",
    resolutionDays: null,
    escalationLevel: "NENHUM",
    confidence: 0.9,
    isDemo: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("подавление малых групп (§57)", () => {
  it("скрывает группу меньше порога целиком", () => {
    // Сегмент из трёх наблюдений опознаёт человека не хуже имени.
    const rows = [
      ...Array.from({ length: 30 }, () => row({ state: "SP" })),
      ...Array.from({ length: 3 }, () => row({ state: "AC" })),
    ];

    const result = groupWithSuppression(rows, (r) => r.state, 25);

    expect(result.buckets.map((b) => b.key)).toEqual(["SP"]);
    // Ни значения, ни названия скрытой группы в выдаче нет.
    expect(JSON.stringify(result.buckets)).not.toContain("AC");
  });

  it("сообщает, сколько скрыто", () => {
    // Иначе читатель решит, что видит всё, и сложит доли до ста процентов.
    const rows = [
      ...Array.from({ length: 30 }, () => row({ state: "SP" })),
      ...Array.from({ length: 3 }, () => row({ state: "AC" })),
      ...Array.from({ length: 2 }, () => row({ state: "RR" })),
    ];

    const result = groupWithSuppression(rows, (r) => r.state, 25);

    expect(result.suppressedGroups).toBe(2);
    expect(result.suppressedCount).toBe(5);
    expect(result.minGroupSize).toBe(25);
  });

  it("пропускает пустые значения, а не считает их группой", () => {
    const rows = [
      ...Array.from({ length: 30 }, () => row({ state: null })),
      ...Array.from({ length: 30 }, () => row({ state: "SP" })),
    ];

    const result = groupWithSuppression(rows, (r) => r.state, 25);
    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.key).toBe("SP");
  });

  it("сортирует по убыванию", () => {
    const rows = [
      ...Array.from({ length: 30 }, () => row({ category: "COBRANCA_INDEVIDA" })),
      ...Array.from({ length: 50 }, () => row({ category: "PRODUTO_NAO_RECEBIDO" })),
    ];

    const result = groupWithSuppression(rows, (r) => r.category, 25);
    expect(result.buckets[0]?.key).toBe("PRODUTO_NAO_RECEBIDO");
  });
});

describe("сводка", () => {
  it("не считает долю на крошечной выборке", () => {
    // Доля по трём делам вводит в заблуждение сильнее, чем её отсутствие.
    const rows = Array.from({ length: 3 }, () => row({ escalationLevel: "SAC" }));
    const summary = summarize(rows, 25);

    expect(summary.total).toBe(3);
    expect(summary.escalated).toBe(3);
    expect(summary.escalationRate).toBeNull();
  });

  it("считает долю, когда выборки достаточно", () => {
    const rows = [
      ...Array.from({ length: 25 }, () => row({ escalationLevel: "SAC" })),
      ...Array.from({ length: 25 }, () => row({ escalationLevel: "NENHUM" })),
    ];
    expect(summarize(rows, 25).escalationRate).toBeCloseTo(0.5);
  });

  it("не показывает медиану срока, пока решённых мало", () => {
    const rows = Array.from({ length: 3 }, () =>
      row({ resolutionStatus: "RESOLVIDO", resolutionDays: 10 }),
    );
    expect(summarize(rows, 25).medianResolutionDays).toBeNull();
  });

  it("считает медиану на достаточной выборке", () => {
    const rows = Array.from({ length: 25 }, (_, index) =>
      row({ resolutionStatus: "RESOLVIDO", resolutionDays: index + 1 }),
    );
    expect(summarize(rows, 25).medianResolutionDays).toBe(13);
  });

  it("медиана чётной выборки — среднее середины", () => {
    expect(median([10, 20])).toBe(15);
    expect(median([])).toBeNull();
  });
});
