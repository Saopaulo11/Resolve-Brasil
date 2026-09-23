import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache, aiProvider } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { loadDataset } from "../../src/ai/evaluation/dataset";
import { formatReport } from "../../src/ai/evaluation/report";
import { evaluationPassed, runEvaluation } from "../../src/ai/evaluation/runner";
import { resetConfigCache } from "../../src/config/env";

/**
 * Прогон набора через настоящего провайдера с подменённой сетью (§81).
 *
 * Без этого связка «набор → провайдер → схема → проверки» держалась бы на
 * том, что каждый кусок проверен отдельно.
 */
function stub(reply: (body: Record<string, unknown>) => unknown): ResponsesLike {
  return {
    responses: {
      async create(body: Record<string, unknown>) {
        return reply(body) as never;
      },
    },
  };
}

function jsonReply(payload: unknown) {
  return {
    output_text: JSON.stringify(payload),
    usage: { input_tokens: 140, output_tokens: 50 },
  };
}

const OPTIONS = { confidenceThreshold: 0.6, sources: [], deep: false };

beforeEach(() => {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
});

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("прогон набора через провайдера", () => {
  it("идеальная модель проходит прогон", async () => {
    const dataset = loadDataset();

    // Модель, отвечающая ровно ожидаемой категорией: так проверяется, что
    // прогон не проваливает правильный ответ.
    const porDescricao = new Map(
      dataset.cases.map((item) => [item.description, item.expectedCategory]),
    );

    setOpenAiClient(
      stub((body) => {
        const input = typeof body.input === "string" ? body.input : "";
        const match = [...porDescricao.entries()].find(([description]) =>
          input.includes(description),
        );
        return jsonReply({
          category: match?.[1] ?? "OUTRO",
          subcategory: null,
          confidence: 0.9,
          missing_information: [],
          recommended_questions: [],
          risk_flags: [],
        });
      }),
    );

    const report = await runEvaluation(aiProvider(), dataset.cases, OPTIONS, "modelo-de-teste");

    expect(report.failed).toBe(0);
    expect(report.accuracy).toBe(1);
    expect(report.violations).toHaveLength(0);
    expect(evaluationPassed(report, 0.8).ok).toBe(true);
  });

  it("ответ не по схеме считается делом без ответа, а не нулевой категорией", async () => {
    // §8: невалидный ответ не показывается «как есть» и не засчитывается
    // как результат — иначе брак модели выглядел бы как её мнение.
    setOpenAiClient(stub(() => jsonReply({ category: "CATEGORIA_INVENTADA" })));

    const dataset = loadDataset();
    const report = await runEvaluation(aiProvider(), dataset.cases.slice(0, 2), OPTIONS);

    expect(report.completed).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.accuracy).toBeNull();
    expect(evaluationPassed(report, 0.8).ok).toBe(false);
  });

  it("нарушение запрета валит прогон при полной точности", async () => {
    const dataset = loadDataset();
    const um = dataset.cases.slice(0, 1);

    setOpenAiClient(
      stub(() =>
        jsonReply({
          category: um[0]?.expectedCategory,
          subcategory: null,
          confidence: 0.95,
          missing_information: [],
          recommended_questions: [],
          risk_flags: ["Garantimos que o valor será devolvido"],
        }),
      ),
    );

    const report = await runEvaluation(aiProvider(), um, OPTIONS);

    expect(report.accuracy).toBe(1);
    expect(report.violations.map((v) => v.kind)).toContain("garantia_de_resultado");
    expect(evaluationPassed(report, 0.8).ok).toBe(false);
  });
});

describe("отчёт о прогоне", () => {
  it("называет набор выдуманным и показывает, из скольких дел доля", async () => {
    setOpenAiClient(
      stub(() =>
        jsonReply({
          category: "OUTRO",
          subcategory: null,
          confidence: 0.4,
          missing_information: [],
          recommended_questions: [],
          risk_flags: [],
        }),
      ),
    );

    const dataset = loadDataset();
    const report = await runEvaluation(aiProvider(), dataset.cases.slice(0, 3), OPTIONS);
    const text = formatReport(report);

    expect(text).toContain("Nenhum caso, empresa ou número aqui é real");
    expect(text).toMatch(/Categoria correta:\s+\d+ de \d+/);
    expect(text).toContain("Proibições: nenhuma violação.");
  });
});
