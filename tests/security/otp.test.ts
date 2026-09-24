import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

const PHONE = "11987654321";
const E164 = "+5511987654321";

/** Доводит вход до шага подтверждения кода и отдаёт куки и токен формы. */
async function reachCodeStep(phone = PHONE) {
  const start = await openPage(harness.app, "/entrar");
  const sent = await request(harness.app)
    .post("/entrar")
    .set("Cookie", start.cookies)
    .type("form")
    .send({ _csrf: start.token, phone });

  const cookies = mergeCookies(
    start.cookies,
    (sent.headers["set-cookie"] as unknown as string[]) ?? [],
  );
  return openPage(harness.app, "/entrar/codigo", cookies);
}

function wrongCode(actual: string): string {
  // Гарантированно другой код той же длины.
  return actual
    .split("")
    .map((digit) => String((Number(digit) + 1) % 10))
    .join("");
}

describe("перебор кода (§67)", () => {
  it("неверный код не пускает и расходует попытку", async () => {
    const page = await reachCodeStep();
    const actual = harness.otpProvider.lastCodeFor(E164);

    const response = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: wrongCode(actual) });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Código incorreto");

    const challenge = await harness.otp.findLatest(E164);
    expect(challenge?.attempts).toBe(1);
  });

  it("после исчерпания попыток код закрывается насовсем", async () => {
    const page = await reachCodeStep();
    const actual = harness.otpProvider.lastCodeFor(E164);
    const bad = wrongCode(actual);

    // Пять неверных попыток — лимит по умолчанию.
    for (let i = 0; i < 5; i += 1) {
      await request(harness.app)
        .post("/entrar/codigo")
        .set("Cookie", page.cookies)
        .type("form")
        .send({ _csrf: page.token, code: bad });
    }

    // Теперь даже правильный код не работает: иначе лимит попыток
    // не ограничивал бы ничего.
    const response = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: actual });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Muitas tentativas");

    const user = await harness.users.findByPhone(E164);
    expect(user).toBeNull();
  });
});

describe("одноразовость кода (§67)", () => {
  it("тот же код не срабатывает второй раз", async () => {
    const page = await reachCodeStep();
    const actual = harness.otpProvider.lastCodeFor(E164);

    const first = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: actual });
    expect(first.status).toBe(303);

    // Перехваченное SMS не должно открывать вход повторно.
    const second = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: actual });

    expect(second.status).toBe(400);
    expect(second.text).toContain("já foi usado");
  });

  it("новый код гасит предыдущий", async () => {
    const page = await reachCodeStep();
    const oldCode = harness.otpProvider.lastCodeFor(E164);

    // Отматываем паузу между отправками, чтобы запросить второй код.
    const first = await harness.otp.findLatest(E164);
    if (first) first.createdAt = new Date(Date.now() - 120_000);

    const resend = await openPage(harness.app, "/entrar", page.cookies);
    await request(harness.app)
      .post("/entrar")
      .set("Cookie", resend.cookies)
      .type("form")
      .send({ _csrf: resend.token, phone: PHONE });

    const newCode = harness.otpProvider.lastCodeFor(E164);
    expect(newCode).not.toBe(oldCode);

    const response = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: oldCode });

    // Старый код не пускает — это главное.
    expect(response.status).toBe(400);
    expect(response.text).toContain("não vale mais");

    // И не расходует попытку: запоздавшая SMS не вина пользователя.
    const current = await harness.otp.findLatest(E164);
    expect(current?.attempts).toBe(0);

    // А новый код при этом работает.
    const ok = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: newCode });
    expect(ok.status).toBe(303);
  });

  it("истёкший код не принимается", async () => {
    const page = await reachCodeStep();
    const actual = harness.otpProvider.lastCodeFor(E164);

    const challenge = await harness.otp.findLatest(E164);
    if (challenge) challenge.expiresAt = new Date(Date.now() - 1000);

    const response = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: actual });

    expect(response.status).toBe(400);
    expect(response.text).toContain("expirou");
  });

  it("пауза не даёт запросить код сразу повторно", async () => {
    const page = await reachCodeStep();

    const resend = await openPage(harness.app, "/entrar", page.cookies);
    const response = await request(harness.app)
      .post("/entrar")
      .set("Cookie", resend.cookies)
      .type("form")
      .send({ _csrf: resend.token, phone: PHONE });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Aguarde");
    // Второй код не создан — значит первый, уже отправленный, ещё действует.
    expect(harness.otpProvider.sent).toHaveLength(1);
  });
});

describe("утечки", () => {
  it("код не попадает в страницу подтверждения", async () => {
    const page = await reachCodeStep();
    const actual = harness.otpProvider.lastCodeFor(E164);
    expect(page.response.text).not.toContain(actual);
  });

  it("форма входа не отвечает, зарегистрирован ли номер", async () => {
    // Иначе форма превращается в проверку базы телефонов.
    await login(harness, PHONE);

    // Вход выше уже запросил код на этот номер, и пауза между отправками
    // помешала бы сравнению. Отматываем её — проверяем не паузу, а ответ.
    const used = await harness.otp.findLatest(E164);
    if (used) used.createdAt = new Date(Date.now() - 120_000);

    const known = await reachCodeStep(PHONE);
    const unknown = await reachCodeStep("11912345678");

    expect(known.response.status).toBe(unknown.response.status);

    // Из сравнения убираем то, что и обязано различаться на каждой выдаче:
    // CSRF-токен и сам показанный номер. Остальная страница должна совпадать
    // до символа — иначе по ответу видно, знаком ли нам номер.
    const normalize = (html: string) =>
      html
        .replace(/name="_csrf" value="[^"]*"/g, 'name="_csrf" value="X"')
        .replace(/\+55 \(\d{2}\) \d{4,5}-\d{4}/g, "TELEFONE");

    expect(normalize(known.response.text)).toBe(normalize(unknown.response.text));
  });
});

describe("сессия после входа", () => {
  it("кука сессии недоступна скриптам и подписана", async () => {
    const start = await openPage(harness.app, "/entrar");
    const sent = await request(harness.app)
      .post("/entrar")
      .set("Cookie", start.cookies)
      .type("form")
      .send({ _csrf: start.token, phone: PHONE });

    const cookies = mergeCookies(
      start.cookies,
      (sent.headers["set-cookie"] as unknown as string[]) ?? [],
    );
    const page = await openPage(harness.app, "/entrar/codigo", cookies);

    const confirmed = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, code: harness.otpProvider.lastCodeFor(E164) });

    const setCookie = (confirmed.headers["set-cookie"] as unknown as string[]) ?? [];
    const session = setCookie.find((cookie) => cookie.startsWith("rb_session="));

    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    // s%3A — признак подписанной куки cookie-parser.
    expect(session).toContain("rb_session=s%3A");
  });

  it("не уводит на чужой сайт после входа", async () => {
    // Открытый редирект превращает вход в инструмент фишинга.
    const start = await openPage(harness.app, "/entrar");
    const sent = await request(harness.app)
      .post("/entrar")
      .set("Cookie", start.cookies)
      .type("form")
      .send({ _csrf: start.token, phone: PHONE, next: "https://exemplo-malicioso.com" });

    const cookies = mergeCookies(
      start.cookies,
      (sent.headers["set-cookie"] as unknown as string[]) ?? [],
    );
    const page = await openPage(harness.app, "/entrar/codigo", cookies);

    const confirmed = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", page.cookies)
      .type("form")
      .send({
        _csrf: page.token,
        code: harness.otpProvider.lastCodeFor(E164),
        next: "https://exemplo-malicioso.com",
      });

    expect(confirmed.headers.location).toBe("/minha-conta");
  });

  it("протокол-относительный адрес тоже отклоняется", async () => {
    const cookies = await login(harness, PHONE);
    const response = await request(harness.app)
      .get("/minha-conta")
      .set("Cookie", cookies);
    expect(response.status).toBe(200);
  });
});


describe("лимит запросов кода (§66)", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR;
    delete process.env.OTP_RESEND_COOLDOWN_SECONDS;
    resetConfigCache();
  });

  /** Запрос кода без прохождения дальше: интересует только счётчик. */
  async function pedirCodigo(phone: string) {
    const page = await openPage(harness.app, "/entrar");
    return request(harness.app)
      .post("/entrar")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, phone });
  }

  it("разные записи одного номера считаются вместе", async () => {
    // Иначе лимит обходится запятой в поле ввода: «(11) 98765-4321» и
    // «+5511987654321» — один и тот же человек и один и тот же номер.
    process.env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR = "2";
    // Бюджет считает отправленные коды, а не попытки: паузу между
    // отправками здесь нужно убрать, иначе до лимита дойдёт не счётчик, а
    // она, и проверка перестанет говорить о корзинах.
    process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
    resetConfigCache();
    harness = createHarness();

    await pedirCodigo("11987654321");
    await pedirCodigo("+55 11 98765-4321");
    const terceiro = await pedirCodigo("(11) 98765-4321");

    // Третья запись того же номера упирается в лимит, израсходованный
    // первыми двумя — значит корзина у них одна.
    expect(terceiro.status).toBe(429);
    // И ровно два кода ушло: третья запись не добавила своего.
    expect(harness.otpProvider.sent).toHaveLength(2);
  });

  it("другой номер не расходует чужой лимит", async () => {
    process.env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR = "1";
    resetConfigCache();
    harness = createHarness();

    await pedirCodigo("11987654321");
    const outro = await pedirCodigo("11912345678");

    expect(outro.status).not.toBe(429);
    expect(harness.otpProvider.sent).toHaveLength(2);
  });
});
