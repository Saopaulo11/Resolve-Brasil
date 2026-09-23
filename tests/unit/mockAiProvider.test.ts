import { describe, expect, it } from "vitest";

import { MockAIProvider } from "../../src/ai/providers/MockAIProvider";
import type { CaseContext } from "../../src/ai/providers/AIProvider";

const context: CaseContext = {
  publicId: "RB-ABC234",
  description: "Comprei e não recebi.",
  category: null,
  subcategory: null,
  companyName: null,
  amount: null,
  currency: "BRL",
  paymentMethod: null,
  purchaseDate: null,
  promisedDate: null,
  status: "NOVO",
  confirmedFacts: [],
  timeline: [],
};

/**
 * §79, §82: заглушка не должна выглядеть работающим AI. Эти тесты
 * фиксируют именно это — что мок ничего не выдумывает.
 */
describe("MockAIProvider ничего не выдумывает", () => {
  const provider = new MockAIProvider();

  it("не выдаёт уверенную классификацию", () => {
    return provider.classifyCase(context).then((result) => {
      expect(result.data.confidence).toBe(0);
      expect(result.data.category).toBe("OUTRO");
    });
  });

  it("не придумывает источники", async () => {
    const result = await provider.searchSources("prazo de entrega", null);
    expect(result.data.sources).toHaveLength(0);
    expect(result.data.not_found).toBe(true);
  });

  it("не придумывает шаги плана действий", async () => {
    const result = await provider.createActionPlan(context);
    expect(result.data.steps).toHaveLength(0);
    expect(result.data.uncertainties.join(" ")).toContain("MOCK");
  });

  it("не придумывает текст письма компании", async () => {
    const result = await provider.createDraft(context);
    expect(result.data.body).toBe("");
    expect(result.data.facts_used).toHaveLength(0);
  });

  it("не извлекает поля из документа", async () => {
    const result = await provider.extractDocument({
      filename: "nota.pdf",
      mimeType: "application/pdf",
      text: "Pedido 123 — R$ 349,90",
    });
    expect(result.data.fields).toHaveLength(0);
  });

  it("помечает себя как mock в метриках вызова", async () => {
    const result = await provider.summarizeCase(context);
    expect(result.meta.provider).toBe("mock");
    expect(result.meta.model).toBe("mock");
  });
});
