import { describe, expect, it } from "vitest";

import type { CaseRecord } from "../../src/cases/caseStore";
import { caseKey, projectCase } from "../../src/analytics/projection";

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";

/** Дело, набитое всем, что наружу попасть не должно. */
function caseWithPii(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    publicId: "RB-ABC234",
    userId: "22222222-2222-4222-8222-222222222222",
    category: "PRODUTO_NAO_RECEBIDO",
    subcategory: "entrega atrasada",
    companyName: "Loja Exemplo",
    companyNormalized: "loja-exemplo",
    description:
      "Meu nome é João Silva, CPF 123.456.789-00, telefone +5511987654321, " +
      "email joao@exemplo.com. Paguei R$ 349,90 via Pix E1234567890.",
    amount: "349.90",
    currency: "BRL",
    paymentMethod: "PIX",
    purchaseDate: new Date("2026-09-10T00:00:00Z"),
    promisedDate: new Date("2026-09-15T00:00:00Z"),
    status: "RESOLVIDO",
    currentStep: null,
    escalationLevel: "SAC",
    priority: "NORMAL",
    state: "SP",
    cityBucket: "capital",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-20T10:00:00Z"),
    closedAt: new Date("2026-09-21T10:00:00Z"),
    ...overrides,
  };
}

const project = (record: CaseRecord, isDemo = false) =>
  projectCase({ caseRecord: record, industry: "ECOMMERCE", secret: SECRET, confidence: 0.9, isDemo });

describe("обезличивание слепка (§56)", () => {
  it("не выносит наружу ничего, ведущего к человеку", () => {
    // Главный тест всей PHASE 9: что бы ни лежало в деле, в аналитику из
    // этого не попадает ничего.
    const serialized = JSON.stringify(project(caseWithPii()));

    for (const secret of [
      "João",
      "Silva",
      "123.456.789-00",
      "+5511987654321",
      "joao@exemplo.com",
      "E1234567890",
      "Meu nome",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("не выносит идентификаторы дела и пользователя", () => {
    const serialized = JSON.stringify(project(caseWithPii()));
    expect(serialized).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(serialized).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(serialized).not.toContain("RB-ABC234");
  });

  it("не выносит текста обращения", () => {
    const projection = project(caseWithPii());
    expect(Object.keys(projection)).not.toContain("description");
  });

  it("заменяет точную сумму диапазоном", () => {
    // Точная сумма вместе с месяцем и городом опознаёт человека.
    const projection = project(caseWithPii());
    expect(projection.amountBucket).toBe("200-500");
    expect(JSON.stringify(projection)).not.toContain("349.9");
  });

  it("заменяет точную дату месяцем", () => {
    const projection = project(caseWithPii());
    expect(projection.month).toBe("2026-09");
    expect(JSON.stringify(projection)).not.toContain("2026-09-01T10");
  });
});

describe("псевдоним дела", () => {
  it("не содержит исходного идентификатора", () => {
    const key = caseKey("11111111-1111-4111-8111-111111111111", SECRET);
    expect(key).not.toContain("1111");
    expect(key).toHaveLength(32);
  });

  it("с другой солью даёт другой псевдоним", () => {
    // Без секретной соли хеш от идентификатора перебирается, и аналитика
    // перестаёт быть обезличенной.
    const id = "11111111-1111-4111-8111-111111111111";
    expect(caseKey(id, "a".repeat(32))).not.toBe(caseKey(id, "b".repeat(32)));
  });

  it("устойчив: одно дело — один псевдоним", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(caseKey(id, SECRET)).toBe(caseKey(id, SECRET));
  });
});

describe("вычисляемые поля", () => {
  it("считает дни до решения", () => {
    expect(project(caseWithPii()).resolutionDays).toBe(20);
  });

  it("у незакрытого дела дней нет", () => {
    const open = caseWithPii({ status: "NOVO", closedAt: null });
    expect(project(open).resolutionDays).toBeNull();
  });

  it("неклассифицированное дело попадает в OUTRO, а не выдумывает категорию", () => {
    const unclassified = caseWithPii({ category: null });
    expect(project(unclassified).category).toBe("OUTRO");
  });

  it("помечает демонстрационные дела", () => {
    expect(project(caseWithPii(), true).isDemo).toBe(true);
  });
});
