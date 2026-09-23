import { describe, expect, it } from "vitest";

import { buildConfig, productionRequirements } from "../../src/config/env";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", ...overrides };
}

describe("требования production", () => {
  it("называет всё, чего не хватает", () => {
    const missing = productionRequirements(buildConfig(env()));
    expect(missing).toContain("DATABASE_URL");
    expect(missing.some((item) => item.startsWith("SESSION_SECRET"))).toBe(true);
    expect(missing).toContain("APP_URL");
  });

  it("считает короткий SESSION_SECRET отсутствующим", () => {
    // 16 символов подбираются; порог в 32 — не украшение.
    const missing = productionRequirements(
      buildConfig(env({ SESSION_SECRET: "curto-demais-123" })),
    );
    expect(missing.some((item) => item.startsWith("SESSION_SECRET"))).toBe(true);
  });

  it("требует ключ и модель, когда выбран OpenAI", () => {
    const missing = productionRequirements(
      buildConfig(env({ AI_PROVIDER: "openai" })),
    );
    expect(missing.some((item) => item.includes("OPENAI_API_KEY"))).toBe(true);
    expect(missing.some((item) => item.includes("OPENAI_MODEL"))).toBe(true);
  });

  it("по умолчанию выбирает mock, а не живого провайдера", () => {
    // Молчаливый переход на платный провайдер — плохое умолчание:
    // деньги и данные уходят наружу без явного решения.
    expect(buildConfig({}).ai.provider).toBe("mock");
  });

  it("неизвестное значение AI_PROVIDER не роняет конфигурацию", () => {
    expect(buildConfig({ AI_PROVIDER: "lixo" }).ai.provider).toBe("mock");
  });
});
