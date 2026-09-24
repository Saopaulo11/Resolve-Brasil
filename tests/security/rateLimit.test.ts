import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { createHarness, openPage, type Harness } from "../helpers/auth";

/**
 * Поведение ограничителя частоты глазами человека (§46, §66).
 *
 * Лимит существует, чтобы не рассылать коды без счёта. Всё остальное —
 * отказ вместо страницы, наказание за опечатку — это не защита, а поломка
 * входа, и проверяется здесь именно с этой стороны.
 */

const PHONE = "11987654321";

let harness: Harness;

beforeEach(() => {
  // Два кода в час: столько же смысла, сколько в пяти, но тест короче.
  process.env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR = "2";
  // Без паузы между отправками: здесь проверяется часовой бюджет, а не она.
  // С паузой по умолчанию второй запрос упрётся в неё, и до лимита дело не
  // дойдёт — то есть тест проверял бы совсем другое правило.
  process.env.OTP_RESEND_COOLDOWN_SECONDS = "0";
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  delete process.env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR;
  delete process.env.OTP_RESEND_COOLDOWN_SECONDS;
  resetConfigCache();
});

/** Запрос кода так, как его делает браузер: со страницы и с её токеном. */
async function pedirCodigo(phone: string) {
  const page = await openPage(harness.app, "/entrar");
  return request(harness.app)
    .post("/entrar")
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, phone });
}

describe("ограничитель частоты", () => {
  it("на исчерпанном лимите отдаёт страницу, а не JSON", async () => {
    await pedirCodigo(PHONE);
    await pedirCodigo(PHONE);
    const bloqueado = await pedirCodigo(PHONE);

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers["content-type"]).toMatch(/text\/html/);

    // Главное: не голая строка с ошибкой, а страница сайта с выходом.
    expect(bloqueado.text).not.toContain('{"error"');
    expect(bloqueado.text).toContain("Voltar ao início");
    expect(bloqueado.text).toContain("Muitas tentativas");
  });

  it("опечатка в номере не тратит бюджет кодов", async () => {
    // Ни один из этих номеров не мог получить код: разбор их отклоняет.
    for (const errado of ["120997847612", "119", "20987654321"]) {
      const resposta = await pedirCodigo(errado);
      expect(resposta.status, errado).toBe(400);
    }

    // После трёх промахов верный номер обязан получить код.
    const certo = await pedirCodigo(PHONE);
    expect(certo.status).not.toBe(429);
    expect(harness.otpProvider.sent).toHaveLength(1);
  });

  it("бюджет всё-таки считается — по верным номерам", async () => {
    // Обратная сторона предыдущего теста: послабление не должно снимать лимит.
    await pedirCodigo(PHONE);
    await pedirCodigo(PHONE);
    await pedirCodigo(PHONE);

    expect(harness.otpProvider.sent).toHaveLength(2);
  });
});
