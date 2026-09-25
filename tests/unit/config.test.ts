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

  /*
   * То же и про канал одноразовых кодов (§79).
   *
   * Разница только в том, чем кончается: заглушка модели отдаёт пустой
   * разбор, заглушка канала не отправляет ничего. Войти на таком стенде
   * нельзя ни одному человеку, а видно это лишь тому, кто дошёл до ввода
   * номера и не получил кода.
   */
  it("mock-канал кода в production считается незаданной настройкой", () => {
    const missing = productionRequirements(buildConfig(env()));
    const linha = missing.find((item) => item.startsWith("OTP_PROVIDER"));
    expect(linha).toBeDefined();
    // Названы оба канала: человеку, у которого нет одобренного шаблона Meta,
    // отказ с именем одного провайдера ничего не объясняет.
    expect(linha).toContain("whatsapp");
    expect(linha).toContain("twilio");
  });

  it("настроенный Twilio претензий к каналу не вызывает", () => {
    process.env.OTP_PROVIDER = "twilio";
    const missing = productionRequirements(
      buildConfig(
        env({
          OTP_PROVIDER: "twilio",
          TWILIO_ACCOUNT_SID: "ACteste",
          TWILIO_AUTH_TOKEN: "token",
          TWILIO_FROM: "+15005550006",
        }),
      ),
    );
    expect(missing.some((item) => item.startsWith("OTP_PROVIDER"))).toBe(false);
  });

  it("явный OTP_PROVIDER=mock в production тоже не проходит", () => {
    // Умолчание и явная заглушка кончаются одинаково, поэтому запрет один.
    process.env.OTP_PROVIDER = "mock";
    const missing = productionRequirements(
      buildConfig(env({ OTP_PROVIDER: "mock" })),
    );
    const linha = missing.find((item) => item.startsWith("OTP_PROVIDER"));
    expect(linha).toContain("mock");
  });

  it("нереализованный канал называется своим значением", () => {
    // Опечатка вроде «whats-app» иначе доживает до первой отправки кода.
    process.env.OTP_PROVIDER = "whats-app";
    const missing = productionRequirements(
      buildConfig(env({ OTP_PROVIDER: "whats-app" })),
    );
    const linha = missing.find((item) => item.startsWith("OTP_PROVIDER"));
    expect(linha).toContain("whats-app");
  });

  it("настроенный WhatsApp претензий к каналу не вызывает", () => {
    process.env.OTP_PROVIDER = "whatsapp";
    const missing = productionRequirements(
      buildConfig(
        env({
          OTP_PROVIDER: "whatsapp",
          WHATSAPP_API_KEY: "token",
          WHATSAPP_PHONE_NUMBER_ID: "123",
          WHATSAPP_API_VERSION: "v21.0",
          WHATSAPP_TEMPLATE: "codigo_de_acesso",
        }),
      ),
    );
    expect(missing.some((item) => item.startsWith("OTP_PROVIDER"))).toBe(false);
    expect(missing.some((item) => item.includes("WHATSAPP_"))).toBe(false);
  });

  it("выбранный WhatsApp без настроек называет каждую переменную", () => {
    // Шаблон и версия заводятся руками в кабинете Meta: неполный набор
    // отвергается Meta целиком, и разбирать это на боевом стенде поздно.
    process.env.OTP_PROVIDER = "whatsapp";
    const missing = productionRequirements(
      buildConfig(env({ OTP_PROVIDER: "whatsapp" })),
    );
    const linha = missing.find((item) => item.includes("WHATSAPP_API_KEY"));
    expect(linha).toContain("WHATSAPP_PHONE_NUMBER_ID");
    expect(linha).toContain("WHATSAPP_API_VERSION");
    expect(linha).toContain("WHATSAPP_TEMPLATE");
  });
});

afterEach(() => {
  delete process.env.AI_PROVIDER;
  delete process.env.OTP_PROVIDER;
});
