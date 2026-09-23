import { describe, expect, it } from "vitest";

import {
  actionPlanSchema,
  caseClassificationSchema,
  draftSchema,
  questionsSchema,
  sourceSearchSchema,
} from "../../src/ai/schemas";

/**
 * §8: вывод модели не показывается пользователю напрямую. Эти тесты
 * фиксируют границу — что именно валидация обязана отсечь.
 */
describe("валидация структурированного вывода AI", () => {
  const valid = {
    category: "PRODUTO_NAO_RECEBIDO",
    subcategory: null,
    confidence: 0.8,
    missing_information: [],
    recommended_questions: [],
    risk_flags: [],
  };

  it("принимает корректную классификацию", () => {
    expect(caseClassificationSchema.safeParse(valid).success).toBe(true);
  });

  it("отклоняет неизвестную категорию", () => {
    // Модель не имеет права изобрести категорию, которой нет в базе.
    expect(
      caseClassificationSchema.safeParse({ ...valid, category: "INVENTADA" }).success,
    ).toBe(false);
  });

  it("отклоняет лишнее поле", () => {
    // strict(): неожиданное поле — признак того, что контракт разъехался.
    expect(
      caseClassificationSchema.safeParse({ ...valid, extra: "surpresa" }).success,
    ).toBe(false);
  });

  it("отклоняет уверенность вне диапазона", () => {
    expect(caseClassificationSchema.safeParse({ ...valid, confidence: 1.4 }).success).toBe(
      false,
    );
    expect(caseClassificationSchema.safeParse({ ...valid, confidence: -1 }).success).toBe(
      false,
    );
  });

  it("не даёт задать больше пяти вопросов за этап", () => {
    // §20: лавина вопросов на первом шаге отпугивает человека.
    const question = (id: string) => ({
      id,
      question: "Qual a data da compra?",
      why: "Define o prazo.",
      required: true,
    });
    const six = { questions: ["1", "2", "3", "4", "5", "6"].map(question) };
    expect(questionsSchema.safeParse(six).success).toBe(false);
  });

  it("требует настоящий URL у источника", () => {
    // §30: выдуманная ссылка на gov.br выглядит убедительнее всего.
    const bad = {
      sources: [
        { organization: "gov.br", title: "Guia", url: "nao-e-url", relevance: 0.9 },
      ],
      not_found: false,
    };
    expect(sourceSearchSchema.safeParse(bad).success).toBe(false);
  });

  it("допускает пустой результат поиска источников", () => {
    // Честное «не нашли» обязано проходить валидацию (§32).
    expect(sourceSearchSchema.safeParse({ sources: [], not_found: true }).success).toBe(
      true,
    );
  });

  it("требует перечислить использованные факты в черновике", () => {
    // §34: письмо не должно содержать того, чего нет в деле.
    const draft = {
      subject: "Pedido 123",
      body: "Texto",
      facts_used: ["pedido 123"],
      warnings: [],
    };
    expect(draftSchema.safeParse(draft).success).toBe(true);
    expect(draftSchema.safeParse({ subject: "a", body: "b" }).success).toBe(false);
  });

  it("требует указывать источник у каждого шага плана", () => {
    const plan = {
      steps: [
        { order: 1, title: "Contatar a empresa", detail: "...", source: "AI_SUGGESTION" },
      ],
      sources: [],
      uncertainties: [],
    };
    expect(actionPlanSchema.safeParse(plan).success).toBe(true);

    const withoutSource = {
      steps: [{ order: 1, title: "Contatar", detail: "..." }],
      sources: [],
      uncertainties: [],
    };
    expect(actionPlanSchema.safeParse(withoutSource).success).toBe(false);
  });
});
