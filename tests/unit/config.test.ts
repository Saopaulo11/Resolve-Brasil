import { afterEach, describe, expect, it } from "vitest";

import { buildConfig, productionRequirements } from "../../src/config/env";

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", ...overrides };
}

describe("требования production", () => {
  it("называет всё, чего не хватает", () => {
    const missing = productionRequirements(buildConfig(env()));
    // Названы оба пути: строка целиком и части. Человеку, который настраивал
    // базу по частям, отказ с именем одной переменной ничего не объясняет.
    const base = missing.find((item) => item.startsWith("DATABASE_URL"));
    expect(base).toBeDefined();
    expect(base).toContain("DATABASE_HOST");
    expect(base).toContain("DATABASE_PASSWORD");
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

  /*
   * Заглушка в production — отказ на старте, а не молчаливая подмена.
   *
   * Значение разбирается с запасным «mock»: опечатка вроде «OpenAI» или
   * лишний пробел дают заглушку, и она возвращает пустой разбор с пометкой
   * MOCK. Человек получит её вместо ответа и не узнает, что дело в одной
   * переменной, — поэтому такую настройку надо ловить при запуске (§79).
   */
  it("mock в production считается незаданной настройкой", () => {
    const missing = productionRequirements(buildConfig(env()));
    expect(missing.some((item) => item.startsWith("AI_PROVIDER"))).toBe(true);
  });

  it("опечатка в AI_PROVIDER называется своим значением", () => {
    process.env.AI_PROVIDER = "OpenAI ";
    const missing = productionRequirements(
      buildConfig(env({ AI_PROVIDER: "OpenAI " })),
    );
    const linha = missing.find((item) => item.startsWith("AI_PROVIDER"));
    expect(linha).toContain("OpenAI");
  });

  it("настроенный провайдер претензий не вызывает", () => {
    const missing = productionRequirements(
      buildConfig(
        env({
          AI_PROVIDER: "openai",
          OPENAI_API_KEY: "chave",
          OPENAI_MODEL: "modelo",
        }),
      ),
    );
    expect(missing.some((item) => item.startsWith("AI_PROVIDER"))).toBe(false);
  });
});

afterEach(() => {
  delete process.env.AI_PROVIDER;
});
