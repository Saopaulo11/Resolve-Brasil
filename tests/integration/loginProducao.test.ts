import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app";
import { resetConfigCache } from "../../src/config/env";
import { createMemoryStores } from "../../src/users/memoryStoreSet";
import { setStores } from "../../src/users/storeRegistry";
import { resetOtpProviderCache } from "../../src/users/otpProvider";

/**
 * Вход в production-режиме целиком, от страницы до отправки кода.
 *
 * Здесь проверяется то, что видно человеку: раньше верный номер на боевом
 * стенде отдавал 500 «Algo deu errado», потому что канал доставки не был
 * реализован и провайдер бросал исключение.
 */

const salvo = { ...process.env };

function produção(extra: Record<string, string> = {}) {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://u:p@localhost:6543/postgres";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.APP_URL = "https://exemplo.test";
  process.env.AI_PROVIDER = "mock";
  delete process.env.OTP_PROVIDER;
  Object.assign(process.env, extra);
  resetConfigCache();
  resetOtpProviderCache();
  setStores(createMemoryStores());
}

/** Запрос кода со страницы входа, как его делает браузер. */
async function pedirCodigo(app: ReturnType<typeof createApp>, phone: string) {
  const page = await request(app).get("/entrar");
  const token = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? "";
  const cookies = (page.headers["set-cookie"] as unknown as string[]) ?? [];
  return request(app)
    .post("/entrar")
    .set("Cookie", cookies)
    .type("form")
    .send({ _csrf: token, phone });
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...salvo };
  resetConfigCache();
  resetOtpProviderCache();
});

describe("вход в production", () => {
  it("без настроенного канала не падает, а объясняет", async () => {
    produção();
    const resposta = await pedirCodigo(createApp(), "11987654321");

    // Главное: не 500 и не «Algo deu errado».
    expect(resposta.status).toBe(400);
    expect(resposta.text).not.toContain("Algo deu errado");
    expect(resposta.text).toContain("Não foi possível enviar o código agora");
    // И человек остаётся на форме со своим номером.
    expect(resposta.text).toContain("11987654321");
  });

  it("/health называет ненастроенный канал", async () => {
    produção();
    const resposta = await request(createApp()).get("/health");
    const corpo = resposta.body as { checks: { otp: { ok: boolean; detail: string } } };

    expect(corpo.checks.otp.ok).toBe(false);
    expect(corpo.checks.otp.detail).toContain("OTP_PROVIDER=mock");
  });

  it("с настроенным WhatsApp код уходит и человек идёт вводить его", async () => {
    const enviados: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      enviados.push(init.body as string);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    produção({
      OTP_PROVIDER: "whatsapp",
      WHATSAPP_API_KEY: "token-de-teste",
      WHATSAPP_PHONE_NUMBER_ID: "123456789",
      WHATSAPP_API_VERSION: "v21.0",
      WHATSAPP_TEMPLATE: "codigo_de_acesso",
    });

    const resposta = await pedirCodigo(createApp(), "11987654321");

    expect([302, 303]).toContain(resposta.status);
    expect(resposta.headers.location).toContain("/entrar/codigo");
    expect(enviados).toHaveLength(1);
    // Код ушёл именно на этот номер.
    expect(enviados[0]).toContain('"to":"5511987654321"');
  });

  it("mock в production не печатает код в лог", async () => {
    // Свойство проверяется на самом провайдере: перехватывать поток пишущего
    // логгера бессмысленно — он держит ссылку на него с момента создания.
    //
    // В production ветка с записью недостижима: отказ возвращается раньше.
    // Вне production код в лог попадает намеренно — иначе локально не войти.
    produção();
    const { MockOtpProvider } = await import("../../src/users/otpProvider");
    const emProducao = await new MockOtpProvider().send("+5511987654321", "123456");

    expect(emProducao.delivered).toBe(false);
    expect(emProducao.error).toBe("provedor_nao_configurado");

    process.env.NODE_ENV = "development";
    resetConfigCache();
    const emDesenvolvimento = await new MockOtpProvider().send("+5511987654321", "123456");
    expect(emDesenvolvimento.delivered).toBe(true);
  });
});
