import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildConfig,
  productionRequirements,
  resetConfigCache,
} from "../../src/config/env";
import { otpProvider, resetOtpProviderCache } from "../../src/users/otpProvider";
import { TwilioOtpProvider } from "../../src/users/twilioOtpProvider";

/**
 * Отправка кода обычным SMS через Twilio.
 *
 * Запрос к Twilio здесь подменён: проверяется то, что мы отправляем и как
 * переживаем отказ. Живой вызов сюда тащить нельзя — он стоит денег и
 * зависит от чужого аккаунта.
 */

const salvo = { ...process.env };

function configurar(extra: Record<string, string> = {}) {
  process.env.OTP_PROVIDER = "twilio";
  process.env.TWILIO_ACCOUNT_SID = "ACtestetestetestetestetesteteste00";
  process.env.TWILIO_AUTH_TOKEN = "token-de-teste";
  process.env.TWILIO_FROM = "+15005550006";
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  Object.assign(process.env, extra);
  resetConfigCache();
}

/** Подменяет fetch и возвращает то, что провайдер отправил. */
function interceptar(resposta: { status: number; body: unknown }) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return new Response(JSON.stringify(resposta.body), {
      status: resposta.status,
      headers: { "content-type": "application/json" },
    });
  });
  return chamadas;
}

const SUCESSO = { sid: "SMtesteteste", status: "queued", error_code: null };

/** Тело запроса как его разберёт Twilio. */
function campos(init: RequestInit): URLSearchParams {
  return new URLSearchParams(init.body as string);
}

beforeEach(() => configurar());

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...salvo };
  resetConfigCache();
  resetOtpProviderCache();
});

describe("Twilio как канал кода входа", () => {
  it("шлёт SMS на нужный адрес и с нужным телом", async () => {
    const chamadas = interceptar({ status: 201, body: SUCESSO });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(true);
    expect(chamadas).toHaveLength(1);

    const { url, init } = chamadas[0]!;
    // Путь собран из версии API и Account SID — так его описывает SDK Twilio.
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACtestetestetestetestetesteteste00/Messages.json",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const corpo = campos(init);
    // Номер уходит в E.164 целиком, вместе с плюсом.
    expect(corpo.get("To")).toBe("+5511987654321");
    expect(corpo.get("From")).toBe("+15005550006");
    expect(corpo.get("Body")).toContain("123456");
  });

  it("срок в сообщении берётся из настройки, а не из текста", async () => {
    // Разойдись он с OTP_TTL_SECONDS — и сообщение начнёт врать человеку про
    // его же код.
    configurar({ OTP_TTL_SECONDS: "600" });
    const chamadas = interceptar({ status: 201, body: SUCESSO });

    await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(campos(chamadas[0]!.init).get("Body")).toContain("10 minutos");
  });

  it("ключ уходит только в заголовок", async () => {
    const chamadas = interceptar({ status: 201, body: SUCESSO });
    await new TwilioOtpProvider().send("+5511987654321", "123456");

    const { init } = chamadas[0]!;
    const headers = init.headers as Record<string, string>;
    // HTTP Basic: SID и токен в заголовке, base64.
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from(
        "ACtestetestetestetestetesteteste00:token-de-teste",
      ).toString("base64")}`,
    );
    // В теле запроса токена быть не должно ни под каким видом (§76).
    expect(init.body as string).not.toContain("token-de-teste");
  });

  it("пул Messaging Service заменяет номер отправителя", async () => {
    configurar({ TWILIO_MESSAGING_SERVICE_SID: "MGtesteteste" });
    delete process.env.TWILIO_FROM;
    resetConfigCache();
    const chamadas = interceptar({ status: 201, body: SUCESSO });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(true);

    const corpo = campos(chamadas[0]!.init);
    expect(corpo.get("MessagingServiceSid")).toBe("MGtesteteste");
    expect(corpo.get("From")).toBeNull();
  });

  it("отказ Twilio не роняет вход, а возвращается отказом", async () => {
    interceptar({
      status: 400,
      body: { code: 21211, message: "The 'To' number is not a valid phone number." },
    });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("twilio_400");
  });

  it("успех с кодом ошибки внутри успехом не считается", async () => {
    // Запрос принят, сообщение — нет. Считать это доставкой значило бы
    // оставить человека ждать SMS, которого не будет.
    interceptar({
      status: 201,
      body: { sid: "SMtesteteste", status: "failed", error_code: 30006 },
    });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("twilio_erro_30006");
  });

  it("успех без идентификатора сообщения успехом не считается", async () => {
    interceptar({ status: 201, body: { status: "queued" } });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("resposta_inesperada");
  });

  it("обрыв связи тоже отказ, а не исключение", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("indisponivel");
  });

  it("без настроек не ходит в сеть вообще", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    resetConfigCache();
    const chamadas = interceptar({ status: 201, body: SUCESSO });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("configuracao_incompleta");
    expect(chamadas).toHaveLength(0);
  });

  it("без отправителя тоже не ходит в сеть", async () => {
    delete process.env.TWILIO_FROM;
    resetConfigCache();
    const chamadas = interceptar({ status: 201, body: SUCESSO });

    const resultado = await new TwilioOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("configuracao_incompleta");
    expect(chamadas).toHaveLength(0);
  });
});

/**
 * Выбор канала — настройкой, а не правкой кода (§79). Провайдер, зашитый в
 * код, означал бы пересборку на каждое переключение; а ошибка в имени должна
 * выясняться при старте, а не при первой отправке кода.
 */
describe("выбор канала настройкой", () => {
  function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { NODE_ENV: "production", ...overrides };
  }

  it("OTP_PROVIDER=twilio даёт провайдер Twilio", () => {
    expect(otpProvider().name).toBe("twilio");
  });

  it("выбранный Twilio без настроек называет каждую переменную", () => {
    const missing = productionRequirements(
      buildConfig(env({ OTP_PROVIDER: "twilio" })),
    );
    const linha = missing.find((item) => item.includes("TWILIO_ACCOUNT_SID"));
    expect(linha).toContain("TWILIO_AUTH_TOKEN");
    // Отправитель — одно из двух: при заданном пуле номер выбирает Twilio.
    expect(linha).toContain("TWILIO_FROM или TWILIO_MESSAGING_SERVICE_SID");
    expect(linha).toContain("OTP_PROVIDER=twilio");
  });

  it("пула Messaging Service достаточно вместо номера", () => {
    const missing = productionRequirements(
      buildConfig(
        env({
          OTP_PROVIDER: "twilio",
          TWILIO_ACCOUNT_SID: "ACteste",
          TWILIO_AUTH_TOKEN: "token",
          TWILIO_MESSAGING_SERVICE_SID: "MGteste",
        }),
      ),
    );
    expect(missing.some((item) => item.includes("TWILIO_"))).toBe(false);
  });

  it("настроенный Twilio претензий не вызывает", () => {
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
    expect(missing.some((item) => item.includes("TWILIO_"))).toBe(false);
  });

  it("незнакомое имя канала не подменяется молча", () => {
    // Молчаливая подмена заглушкой — это код, который никуда не уходит, и
    // человек без объяснения, почему он не может войти.
    process.env.OTP_PROVIDER = "twillio";
    resetConfigCache();
    resetOtpProviderCache();

    expect(() => otpProvider()).toThrow(/twillio/);
  });
});
