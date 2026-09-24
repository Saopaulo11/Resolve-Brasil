import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { PDF_BYTES } from "../helpers/files";

/**
 * Файл сверх предела при вводе (§6, §23).
 *
 * Разбор multipart, упёршись в свой лимит, обрывает весь запрос: тело до
 * обработчика не доходит, и вместе с ним пропадает рассказ, который человек
 * только что написал. Для снимка с телефона, который на пару мегабайт
 * больше предела, такая цена неприемлема — второй раз рассказ не набирают.
 */
const RELATO =
  "Comprei uma geladeira, paguei no Pix em 10/09/2026 e até hoje não recebi.";

/** Достаточно большой, чтобы не пройти предел, и достаточно малый для теста. */
const GRANDE = Buffer.concat([PDF_BYTES, Buffer.alloc(4096)]);

let harness: Harness;

beforeEach(() => {
  process.env.STORAGE_MAX_FILE_SIZE_BYTES = "1024";
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  delete process.env.STORAGE_MAX_FILE_SIZE_BYTES;
  resetConfigCache();
});

describe("слишком большой файл при вводе", () => {
  it("не уносит с собой рассказ и не отменяет дело", async () => {
    const sessao = await login(harness, "11987654321");
    const home = await openPage(harness.app, "/", sessao);

    const resposta = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .field("_csrf", home.token)
      .field("description", RELATO)
      .attach("arquivo", GRANDE, { filename: "grande.pdf", contentType: "application/pdf" });

    // Дело создано: рассказ важнее вложения.
    expect(resposta.status).toBe(303);
    const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(resposta.headers.location ?? "")?.[1];
    expect(publicId).toMatch(/^RB-[A-Z2-9]{6}$/);

    // А про файл сказано словами, а не общей страницей ошибки.
    expect(decodeURIComponent(resposta.headers.location ?? "")).toContain("grande.pdf");

    const caso = await harness.cases.findByPublicId(publicId ?? "");
    expect(caso?.description).toContain("geladeira");
    expect(await harness.documents.listForCase(caso?.id ?? "")).toHaveLength(0);
  });

  it("на странице дела отказ тоже остаётся обычным сообщением", async () => {
    const sessao = await login(harness, "11987654321");
    const home = await openPage(harness.app, "/", sessao);
    const criado = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token, description: RELATO });

    const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(criado.headers.location ?? "")?.[1];
    const pagina = await openPage(harness.app, `/caso/${publicId}`, sessao);

    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos`)
      .set("Cookie", pagina.cookies)
      .field("_csrf", pagina.token)
      .field("tipo", "OUTRO")
      .attach("arquivo", GRANDE, { filename: "grande.pdf", contentType: "application/pdf" });

    expect(resposta.status).toBe(303);
    expect(decodeURIComponent(resposta.headers.location ?? "")).toContain("grande.pdf");
  });
});
