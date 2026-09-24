import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { createHarness, openPage, mergeCookies, type Harness } from "../helpers/auth";

/**
 * Пауза между отправками кода глазами человека (§67).
 *
 * Сама пауза существовала и раньше — она защищает от того, что каждый новый
 * код гасит предыдущий. Не было видно, сколько ждать: кнопка выглядела
 * рабочей, нажатие возвращало отказ, и это читалось как поломка.
 */

const PHONE = "11987654321";

let harness: Harness;

beforeEach(() => {
  process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  delete process.env.OTP_RESEND_COOLDOWN_SECONDS;
  resetConfigCache();
});

/** Доводит вход до шага кода и отдаёт куки. */
async function ateOPassoDoCodigo(phone = PHONE) {
  const start = await openPage(harness.app, "/entrar");
  const enviado = await request(harness.app)
    .post("/entrar")
    .set("Cookie", start.cookies)
    .type("form")
    .send({ _csrf: start.token, phone });

  return mergeCookies(
    start.cookies,
    (enviado.headers["set-cookie"] as unknown as string[]) ?? [],
  );
}

describe("пауза до повторной отправки", () => {
  it("страница кода называет остаток секундами", async () => {
    const cookies = await ateOPassoDoCodigo();
    const pagina = await request(harness.app)
      .get("/entrar/codigo")
      .set("Cookie", cookies);

    expect(pagina.status).toBe(200);
    expect(pagina.text).toMatch(
      /Você poderá solicitar um novo código em \d+ segundos/,
    );
    // Кнопка называется так, как просит человек её нажать.
    expect(pagina.text).toContain("Reenviar código");
    // Остаток уходит в разметку — по нему скрипт ведёт отсчёт.
    expect(pagina.text).toMatch(/data-reenvio="\d+"/);
  });

  it("кнопка приходит доступной: блокировать её может только скрипт", async () => {
    // Иначе при неработающем скрипте она осталась бы мёртвой навсегда.
    const cookies = await ateOPassoDoCodigo();
    const pagina = await request(harness.app)
      .get("/entrar/codigo")
      .set("Cookie", cookies);

    const botao = /<button[^>]*data-reenvio-botao[^>]*>/.exec(pagina.text)?.[0] ?? "";
    expect(botao).not.toContain("disabled");
  });

  it("ранний повтор возвращает на шаг кода, а не выбрасывает назад", async () => {
    const cookies = await ateOPassoDoCodigo();
    const pagina = await openPage(harness.app, "/entrar/codigo", cookies);

    const repetido = await request(harness.app)
      .post("/entrar")
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, phone: PHONE });

    expect(repetido.status).toBe(303);
    expect(repetido.headers.location).toContain("/entrar/codigo");
    // Второго кода не ушло.
    expect(harness.otpProvider.sent).toHaveLength(1);
  });

  it("повторные запросы не создают два действующих кода сразу", async () => {
    // Каждый новый код гасит предыдущий — иначе пришедшее сообщение могло бы
    // оказаться уже недействительным, и человек вводил бы верный с виду код.
    process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
    resetConfigCache();
    harness = createHarness();

    await ateOPassoDoCodigo();
    await ateOPassoDoCodigo();
    const cookies = await ateOPassoDoCodigo();

    expect(harness.otpProvider.sent).toHaveLength(3);
    const primeiro = harness.otpProvider.sent[0]!.code;
    const ultimo = harness.otpProvider.sent[2]!.code;

    // Первый код уже погашен.
    const pagina = await openPage(harness.app, "/entrar/codigo", cookies);
    const velho = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, code: primeiro });

    expect(velho.status).toBe(400);

    // А последний — работает.
    const atual = await openPage(harness.app, "/entrar/codigo", pagina.cookies);
    const novo = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", atual.cookies)
      .type("form")
      .send({ _csrf: atual.token, code: ultimo });

    expect([302, 303]).toContain(novo.status);
  });

  it("сброс паузы вне production снимает ожидание", async () => {
    // DEVELOPMENT ONLY: без него ручной прогон входа упирается в минуту.
    const cookies = await ateOPassoDoCodigo();
    const pagina = await openPage(harness.app, "/entrar/codigo", cookies);

    const reset = await request(harness.app)
      .post("/entrar/reiniciar-espera")
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token });

    expect(reset.status).toBe(303);

    // Теперь код можно просить снова, и он приходит.
    const novamente = await openPage(harness.app, "/entrar/codigo", pagina.cookies);
    const repetido = await request(harness.app)
      .post("/entrar")
      .set("Cookie", novamente.cookies)
      .type("form")
      .send({ _csrf: novamente.token, phone: PHONE });

    expect([302, 303]).toContain(repetido.status);
    expect(harness.otpProvider.sent).toHaveLength(2);
  });

  it("городской номер на входе не принимается", async () => {
    // Код уходит в WhatsApp, а на городской номер он не придёт никогда.
    const start = await openPage(harness.app, "/entrar");
    const resposta = await request(harness.app)
      .post("/entrar")
      .set("Cookie", start.cookies)
      .type("form")
      .send({ _csrf: start.token, phone: "1133334444" });

    expect(resposta.status).toBe(400);
    expect(resposta.text).toContain("Digite um número de celular válido com DDD.");
    expect(harness.otpProvider.sent).toHaveLength(0);
  });

  it("после верного номера страница говорит, что код отправлен", async () => {
    const cookies = await ateOPassoDoCodigo();
    const pagina = await request(harness.app)
      .get("/entrar/codigo")
      .set("Cookie", cookies);

    expect(pagina.text).toContain("Enviamos um código para seu telefone.");
  });

  it("без начатого входа пауза объясняется словами, а не пустой страницей", async () => {
    // Кука могла истечь. Тогда шаг кода всё равно отправит назад, и человек
    // получил бы страницу входа без единого слова о том, что произошло.
    await ateOPassoDoCodigo();

    const semCookie = await openPage(harness.app, "/entrar");
    const resposta = await request(harness.app)
      .post("/entrar")
      .set("Cookie", semCookie.cookies)
      .type("form")
      .send({ _csrf: semCookie.token, phone: PHONE });

    expect(resposta.status).toBe(400);
    expect(resposta.text).toMatch(
      /Você poderá solicitar um novo código em \d+ segundos/,
    );
    expect(harness.otpProvider.sent).toHaveLength(1);
  });
});
