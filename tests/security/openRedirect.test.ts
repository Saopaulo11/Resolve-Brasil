import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, openPage, type Harness } from "../helpers/auth";

/**
 * Открытый редирект на входе (§66).
 *
 * Адрес возврата приходит из запроса. Если его не проверить, ссылка вида
 * «/entrar?next=//чужой-сайт» отправит человека на чужую страницу сразу
 * после входа — с полным ощущением, что он всё ещё у нас.
 */
let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

/** Куда уводит форма входа при заданном адресе возврата. */
async function destino(next: string): Promise<string> {
  const page = await openPage(
    harness.app,
    `/entrar?next=${encodeURIComponent(next)}`,
  );

  const response = await request(harness.app)
    .post("/entrar")
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, phone: "11987654321", next });

  return response.headers.location ?? "";
}

describe("адрес возврата после входа", () => {
  it("внутренний путь сохраняется", async () => {
    expect(await destino("/caso/RB-ABC123")).toContain(
      encodeURIComponent("/caso/RB-ABC123"),
    );
  });

  it("протокол-относительный адрес отбрасывается", async () => {
    const location = await destino("//exemplo-malicioso.com");
    expect(location).not.toContain("exemplo-malicioso");
    expect(location).toContain(encodeURIComponent("/minha-conta"));
  });

  it("обратный слеш не проходит за внутренний путь", async () => {
    // «/\exemplo.com» выглядит внутренним путём, но браузер читает
    // обратный слеш как второй слеш и уходит на чужой сайт.
    const location = await destino("/\\exemplo-malicioso.com");
    expect(location).not.toContain("exemplo-malicioso");
    expect(location).toContain(encodeURIComponent("/minha-conta"));
  });

  it("абсолютный адрес отбрасывается", async () => {
    const location = await destino("https://exemplo-malicioso.com/entrar");
    expect(location).not.toContain("exemplo-malicioso");
  });

  it("javascript: отбрасывается", async () => {
    const location = await destino("javascript:alert(1)");
    expect(location).not.toContain("javascript");
  });

  it("путь с параметрами и якорем сохраняется целиком", async () => {
    // Отбрасывать лишнее нельзя: человек вернётся не туда, откуда ушёл.
    const location = await destino("/caso/RB-ABC123?aba=documentos#fatos");
    expect(decodeURIComponent(location)).toContain("/caso/RB-ABC123?aba=documentos#fatos");
  });
});
