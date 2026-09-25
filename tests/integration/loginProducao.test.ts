import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app";
import { loadConfig, resetConfigCache } from "../../src/config/env";
import { resetOtpProviderCache } from "../../src/users/otpProvider";
import { ambienteDeProducao } from "../helpers/producao";

/**
 * Вход в production-режиме целиком, от страницы до отправки кода.
 *
 * Здесь проверяется то, что видно человеку: раньше верный номер на боевом
 * стенде отдавал 500 «Algo deu errado», потому что канал доставки не был
 * реализован и провайдер бросал исключение.
 */

const salvo = { ...process.env };

function produção(extra: Record<string, string> = {}) {
  ambienteDeProducao(extra);
}

/** Ответ Meta на отправку — подделанный, но той же формы, что настоящий. */
function metaResponde(status: number, body: unknown): string[] {
  const enviados: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    enviados.push(init.body as string);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return enviados;
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
  it("отказ канала не падает, а объясняет", async () => {
    produção();
    // Meta отвергает сообщение — например, шаблон переименовали в кабинете.
    metaResponde(400, { error: { message: "Template name does not exist" } });

    const resposta = await pedirCodigo(createApp(), "11987654321");

    // Главное: не 500 и не «Algo deu errado».
    expect(resposta.status).toBe(400);
    expect(resposta.text).not.toContain("Algo deu errado");
    expect(resposta.text).toContain("Não foi possível enviar o código agora");
    // И человек остаётся на форме со своим номером.
    expect(resposta.text).toContain("11987654321");
  });

  it("заглушка канала в production не поднимается вовсе", async () => {
    // Незаданный OTP_PROVIDER даёт mock. Прежде стенд с ним поднимался, и
    // выяснялось это у первого человека, набравшего свой номер: код не
    // уходил никуда, а войти было нельзя вообще. Теперь стенд отказывается
    // стартовать и называет переменную.
    produção();
    delete process.env.OTP_PROVIDER;
    resetConfigCache();

    expect(() => loadConfig()).toThrow(/OTP_PROVIDER/);
  });

  it("опечатка в имени канала тоже останавливает старт", async () => {
    // Иначе она доживает до первой отправки кода.
    produção({ OTP_PROVIDER: "whats-app" });
    resetConfigCache();

    expect(() => loadConfig()).toThrow(/OTP_PROVIDER/);
  });

  it("/health называет настроенный канал", async () => {
    produção();
    const resposta = await request(createApp()).get("/health");
    const corpo = resposta.body as { checks: { otp: { ok: boolean; detail: string } } };

    expect(corpo.checks.otp.ok).toBe(true);
    expect(corpo.checks.otp.detail).toContain("OTP_PROVIDER=whatsapp");
  });

  it("/health вне production называет заглушку заглушкой", async () => {
    // Стенды разработки на mock работают, и по /health это должно быть видно:
    // «ok» там означало бы, что код куда-то уходит.
    produção();
    process.env.NODE_ENV = "development";
    delete process.env.OTP_PROVIDER;
    resetConfigCache();

    const resposta = await request(createApp()).get("/health");
    const corpo = resposta.body as { checks: { otp: { ok: boolean; detail: string } } };

    expect(corpo.checks.otp.ok).toBe(false);
    expect(corpo.checks.otp.detail).toContain("OTP_PROVIDER=mock");
  });

  it("с настроенным WhatsApp код уходит и человек идёт вводить его", async () => {
    produção();
    const enviados = metaResponde(200, { messages: [{ id: "wamid.OK" }] });

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
    // Конфигурация до этого провайдера в production уже не доводит, но
    // свойство проверяется и здесь: код в логе — прямая утечка второго
    // фактора (§76), и стоит она столько, что одной проверки при старте
    // мало. Вне production код в лог попадает намеренно — иначе локально
    // не войти.
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

  it("маршрут сброса паузы в production не существует", async () => {
    // Он не закрыт проверкой, а не зарегистрирован вовсе: обходить нечего.
    produção();
    const app = createApp();

    // С настоящим токеном формы: иначе 403 от защиты CSRF сказал бы лишь
    // то, что токена нет, а не то, что маршрута не существует.
    const pagina = await request(app).get("/entrar");
    const token = /name="_csrf" value="([^"]+)"/.exec(pagina.text)?.[1] ?? "";
    const cookies = (pagina.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(token).not.toBe("");

    const resposta = await request(app)
      .post("/entrar/reiniciar-espera")
      .set("Cookie", cookies)
      .type("form")
      .send({ _csrf: token });

    expect(resposta.status).toBe(404);
  });
});
