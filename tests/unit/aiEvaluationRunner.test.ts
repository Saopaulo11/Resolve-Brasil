import { describe, expect, it } from "vitest";

import { contextFor, evaluationPassed, runEvaluation } from "../../src/ai/evaluation/runner";
import type { EvalCase } from "../../src/ai/evaluation/dataset";
import type {
  AIProvider,
  AiResult,
  CaseContext,
} from "../../src/ai/providers/AIProvider";
import type { ActionPlan, CaseClassification, Draft } from "../../src/ai/schemas";

/**
 * Прогон оценки (§81).
 *
 * Провайдер подменён: проверяется наша арифметика и наш вердикт, а не
 * чужая модель.
 */
function meta() {
  return {
    provider: "openai" as const,
    model: "modelo-de-teste",
    operation: "classifyCase",
    promptVersion: null,
    inputTokens: 100,
    outputTokens: 30,
    latencyMs: 10,
    success: true,
    errorCode: null,
  };
}

function wrap<T>(data: T): AiResult<T> {
  return { data, meta: meta() };
}

type Behaviour = {
  classification?: Partial<CaseClassification>;
  plan?: ActionPlan;
  draft?: Draft;
  throwOn?: string;
};

function fakeProvider(byCase: Record<string, Behaviour>): AIProvider {
  const notUsed = () => {
    throw new Error("не должно вызываться в этом прогоне");
  };

  return {
    name: "openai",
    async classifyCase(context: CaseContext) {
      const id = context.publicId.replace("EVAL-", "");
      const behaviour = byCase[id] ?? {};
      if (behaviour.throwOn === "classify") throw new Error("provedor indisponível");

      return wrap<CaseClassification>({
        category: "PRODUTO_NAO_RECEBIDO",
        subcategory: null,
        confidence: 0.9,
        missing_information: [],
        recommended_questions: [],
        risk_flags: [],
        ...behaviour.classification,
      });
    },
    async createActionPlan(context: CaseContext) {
      const id = context.publicId.replace("EVAL-", "");
      return wrap<ActionPlan>(
        byCase[id]?.plan ?? { steps: [], sources: [], uncertainties: [] },
      );
    },
    async createDraft(context: CaseContext) {
      const id = context.publicId.replace("EVAL-", "");
      return wrap<Draft>(
        byCase[id]?.draft ?? {
          subject: "Assunto",
          body: "Corpo da mensagem sem promessas.",
          facts_used: [],
          warnings: [],
        },
      );
    },
    extractDocument: notUsed,
    generateQuestions: notUsed,
    analyzeResponse: notUsed,
    summarizeCase: notUsed,
    searchSources: notUsed,
  } as unknown as AIProvider;
}

function evalCase(id: string, expected: EvalCase["expectedCategory"]): EvalCase {
  return {
    id,
    synthetic: true,
    description: "Comprei um produto na Loja Exemplo e ele não chegou.",
    companyName: "Loja Exemplo",
    amount: null,
    paymentMethod: null,
    expectedCategory: expected,
    note: "",
  };
}

const OPTIONS = { confidenceThreshold: 0.6, sources: [], deep: false };

describe("прогон оценки", () => {
  it("считает точность от дел, дошедших до ответа", async () => {
    const report = await runEvaluation(
      fakeProvider({
        "a": {},
        "b": { classification: { category: "COBRANCA_INDEVIDA" } },
      }),
      [evalCase("a", "PRODUTO_NAO_RECEBIDO"), evalCase("b", "PRODUTO_NAO_RECEBIDO")],
      OPTIONS,
    );

    expect(report.correct).toBe(1);
    expect(report.completed).toBe(2);
    expect(report.accuracy).toBe(0.5);
  });

  it("сбой одного дела не останавливает прогон", async () => {
    const report = await runEvaluation(
      fakeProvider({ "a": { throwOn: "classify" }, "b": {} }),
      [evalCase("a", "PRODUTO_NAO_RECEBIDO"), evalCase("b", "PRODUTO_NAO_RECEBIDO")],
      OPTIONS,
    );

    expect(report.failed).toBe(1);
    expect(report.completed).toBe(1);
    // Точность считается только из дошедших: иначе сбой сети выглядел бы
    // как ошибка модели.
    expect(report.accuracy).toBe(1);
    expect(report.outcomes[0]?.error).toContain("provedor indisponível");
  });

  it("без единого ответа доли нет", async () => {
    const report = await runEvaluation(
      fakeProvider({ "a": { throwOn: "classify" } }),
      [evalCase("a", "PRODUTO_NAO_RECEBIDO")],
      OPTIONS,
    );

    expect(report.accuracy).toBeNull();
  });

  it("отмечает уверенную ошибку отдельно", async () => {
    const report = await runEvaluation(
      fakeProvider({
        "seguro": { classification: { category: "COBRANCA_INDEVIDA", confidence: 0.95 } },
        "inseguro": { classification: { category: "COBRANCA_INDEVIDA", confidence: 0.2 } },
      }),
      [
        evalCase("seguro", "PRODUTO_NAO_RECEBIDO"),
        evalCase("inseguro", "PRODUTO_NAO_RECEBIDO"),
      ],
      OPTIONS,
    );

    // Обе ошибки, но уверенную никто не перепроверит — её и считаем.
    expect(report.correct).toBe(0);
    expect(report.confidentlyWrong).toBe(1);
  });

  it("глубокий прогон проверяет план и письмо", async () => {
    const report = await runEvaluation(
      fakeProvider({
        "a": {
          plan: {
            steps: [
              {
                order: 1,
                title: "Exija o reembolso",
                detail: "O art. 49 do CDC garante esse direito.",
                source: "AI_SUGGESTION",
              },
            ],
            sources: [],
            uncertainties: [],
          },
          draft: {
            subject: "Cobrança",
            body: "Garantimos a devolução integral do valor.",
            facts_used: [],
            warnings: [],
          },
        },
      }),
      [evalCase("a", "PRODUTO_NAO_RECEBIDO")],
      { ...OPTIONS, deep: true },
    );

    const kinds = report.violations.map((violation) => violation.kind);
    expect(kinds).toContain("citacao_legal_sem_fonte");
    expect(kinds).toContain("garantia_de_resultado");
  });
});

describe("вердикт прогона", () => {
  const base = {
    provider: "openai",
    model: "modelo-de-teste",
    startedAt: new Date(),
    total: 10,
    completed: 10,
    failed: 0,
    correct: 9,
    accuracy: 0.9,
    confidentlyWrong: 0,
    violations: [],
    outcomes: [],
    durationMs: 100,
  };

  it("хорошая точность без нарушений проходит", () => {
    expect(evaluationPassed(base, 0.8).ok).toBe(true);
  });

  it("одно нарушение запрета проваливает прогон при любой точности", () => {
    // Ответ, обещающий результат, — брак, а не процент качества.
    const comViolacao = {
      ...base,
      accuracy: 1,
      correct: 10,
      violations: [
        { kind: "garantia_de_resultado" as const, evidence: "Garantimos", where: "rascunho" },
      ],
    };

    const verdict = evaluationPassed(comViolacao, 0.8);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("нарушений запретов");
  });

  it("точность ниже порога проваливает прогон", () => {
    const verdict = evaluationPassed({ ...base, accuracy: 0.5, correct: 5 }, 0.8);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("ниже порога");
  });

  it("дело без ответа проваливает прогон", () => {
    const verdict = evaluationPassed({ ...base, failed: 1, completed: 9 }, 0.8);
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("без ответа");
  });
});

describe("выборка для модели", () => {
  it("в контекст не попадает ничего, кроме дела", () => {
    const context = contextFor(evalCase("a", "PRODUTO_NAO_RECEBIDO"));

    expect(context.publicId).toBe("EVAL-a");
    expect(context.confirmedFacts).toEqual([]);
    expect(context.timeline).toEqual([]);
    expect(Object.keys(context)).not.toContain("phone");
  });
});
