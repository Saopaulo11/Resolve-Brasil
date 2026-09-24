import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, openPage, type Harness } from "../helpers/auth";

/**
 * Отказ на нашей стороне при создании дела (§23).
 *
 * Общая страница «Algo deu errado» здесь — тупик: рассказ, который человек
 * только что написал своими словами, пропадает вместе с ней. Второй раз он
 * его не наберёт — просто уйдёт.
 */
const RELATO =
  "Comprei uma geladeira, paguei no Pix em 10/09/2026 e até hoje não recebi.";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
  // База недоступна — ровно то, что происходило на боевом стенде.
  harness.cases.create = async () => {
    throw new Error(
      "connect ECONNREFUSED postgresql://postgres:SenhaReal@db.exemplo.com:6543/postgres",
    );
  };
});

async function enviar() {
  const home = await openPage(harness.app, "/");
  return request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: RELATO, categoria: "produto-nao-recebido" });
}

describe("когда дело не удалось создать", () => {
  it("возвращает рассказ человека в форму", async () => {
    const resposta = await enviar();

    expect(resposta.status).toBe(503);
    expect(resposta.text).toContain("Comprei uma geladeira");
    expect(resposta.text).toContain("</textarea>");
  });

  it("объясняет, что данные не потеряны, и даёт повторить", async () => {
    const resposta = await enviar();

    expect(resposta.text).toContain("Não conseguimos analisar seu caso agora");
    expect(resposta.text).toContain("Seus dados foram preservados");
    expect(resposta.text).toContain("Tentar novamente");
    expect(resposta.text).toContain("Voltar ao início");
    // Общая заглушка больше не показывается.
    expect(resposta.text).not.toContain("Algo deu errado");
  });

  it("не выносит наружу техническую причину", async () => {
    const resposta = await enviar();

    expect(resposta.text).not.toContain("ECONNREFUSED");
    expect(resposta.text).not.toContain("SenhaReal");
    expect(resposta.text).not.toContain("db.exemplo.com");
  });

  it("помнит выбранную категорию", async () => {
    const resposta = await enviar();

    expect(resposta.text).toContain('name="categoria"');
    expect(resposta.text).toContain('value="produto-nao-recebido"');
  });
});
