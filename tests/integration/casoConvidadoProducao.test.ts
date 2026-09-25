import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { resetConfigCache } from "../../src/config/env";
import { ambienteDeProducao } from "../helpers/producao";

/**
 * Создание дела гостем в production-режиме.
 *
 * На боевом стенде POST /caso/novo отвечал 500 «Algo deu errado», хотя дело
 * в базе создавалось: в таблице оказались и дело, и событие хронологии, и
 * вложения. Значит, обрывалось всё уже после записи — на последнем шаге,
 * которого нет у вошедшего пользователя: подписанной куке с номером дела.
 *
 * Локально этого не видно: там NODE_ENV=development. Поэтому проверка идёт
 * именно с production-конфигурацией — иначе тот же обрыв повторится на
 * стенде и снова останется незамеченным.
 */

const salvo = { ...process.env };

function producao() {
  ambienteDeProducao();
}

/** Создание дела так, как это делает браузер: сначала страница, потом POST. */
async function criarComoConvidado(app: ReturnType<typeof createApp>) {
  const pagina = await request(app).get("/");
  const token = /name="_csrf" value="([^"]+)"/.exec(pagina.text)?.[1] ?? "";
  const cookies = (pagina.headers["set-cookie"] as unknown as string[]) ?? [];

  return request(app)
    .post("/caso/novo")
    .set("Cookie", cookies)
    .type("form")
    .send({
      _csrf: token,
      description:
        "Comprei um produto pela internet, o prazo de entrega terminou e " +
        "até agora não recebi o pedido.",
    });
}

afterEach(() => {
  process.env = { ...salvo };
  resetConfigCache();
});

describe("гость заводит дело в production", () => {
  it("уводит на страницу дела, а не на «Algo deu errado»", async () => {
    producao();

    const resposta = await criarComoConvidado(createApp());

    // Главное: не 500. Дело создано — значит человека надо увести к нему.
    expect(resposta.text).not.toContain("Algo deu errado");
    expect(resposta.status).toBe(303);
    expect(resposta.headers.location).toMatch(/^\/caso\/RB-[A-Z2-9]{6}$/);
  });

  it("кладёт номер дела в подписанную куку", async () => {
    producao();

    const resposta = await criarComoConvidado(createApp());
    const cookies = (resposta.headers["set-cookie"] as unknown as string[]) ?? [];
    const pendente = cookies.find((c) => c.startsWith("rb_caso="));

    // Без этой куки гость не откроет собственное дело: страница дела
    // разрешает доступ только по совпадению номера в куке.
    expect(pendente).toBeDefined();
    expect(pendente).toContain("HttpOnly");
    // В production кука обязана быть Secure — иначе её видно в открытом HTTP.
    expect(pendente).toContain("Secure");
  });
});
