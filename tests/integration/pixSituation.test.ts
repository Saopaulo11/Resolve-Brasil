import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCaseContext } from "../../src/ai/context";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Ситуация с Pix (§36).
 *
 * Pix — основной способ оплаты в Бразилии, и разные беды с ним ведут в
 * разные стороны: мошенничество, платёж не тем, спор с реальной компанией.
 * Отличить их по рассказу нельзя, поэтому выбирает человек (§5).
 */
let harness: Harness;
let cookies: string[];
let publicId: string;

async function criarCaso() {
  cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({
      _csrf: home.token,
      description: "Paguei no Pix e o produto nunca chegou.",
    });

  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

/** Дело становится «оплаченным через Pix» так же, как в продукте. */
async function marcarPix() {
  const caso = await harness.cases.findByPublicId(publicId);
  await harness.cases.setFields(caso!.id, { paymentMethod: "PIX" });
}

async function informarSituacao(situacao: string) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/pix`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, situacao });
}

beforeEach(async () => {
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
  resetConfigCache();
  harness = createHarness();
  await criarCaso();
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  resetConfigCache();
});

describe("вопрос о Pix", () => {
  it("не задаётся, пока способ оплаты неизвестен", async () => {
    // Иначе поле заполнялось бы там, где проверить его нечем, и уезжало в
    // аналитику как настоящий признак.
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).not.toContain("Sobre o Pix");
  });

  it("появляется, когда оплата через Pix", async () => {
    await marcarPix();

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Sobre o Pix");
    expect(page.text).toContain("Foi um golpe");
    expect(page.text).toContain("Enviei para a chave errada");
  });

  it("не обещает процедур и сроков", async () => {
    // §9: процедуры и сроки меняются и обязаны приходить из проверенного
    // источника, а не из строки в коде, которую никто не перечитывает.
    await marcarPix();

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    // Проверяется сам блок про Pix, а не вся страница: сроки напоминаний
    // на ней есть законно, и они к процедуре отношения не имеют.
    // Срез до «Lembretes»: документы переехали выше блока про Pix, и
    // прежняя граница оказалась перед его началом — срез выходил пустым, а
    // проверка на запреты проходила бы, ничего не проверяя.
    const bloco = page.text.slice(
      page.text.indexOf('id="pix"'),
      page.text.indexOf('id="lembretes"'),
    );

    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).not.toMatch(/\b\d+\s*dias\b/);
    expect(bloco).not.toContain("MED");
    expect(bloco).toContain("fonte oficial confirmada");
  });
});

describe("сохранение ситуации", () => {
  it("записывается в дело и в хронологию как факт человека", async () => {
    await marcarPix();
    const response = await informarSituacao("GOLPE_FRAUDE");
    expect(response.status).toBe(303);

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.pixSituation).toBe("GOLPE_FRAUDE");

    const eventos = await harness.cases.listEvents(caso!.id);
    const evento = eventos.find((item) => item.type === "pix_situacao");
    expect(evento?.source).toBe("USER_FACT");
    expect(evento?.title).toContain("golpe");
  });

  it("уходит модели как факт пользователя", async () => {
    await marcarPix();
    await informarSituacao("DESTINATARIO_ERRADO");

    const caso = await harness.cases.findByPublicId(publicId);
    const context = buildCaseContext({ case: caso!, timeline: [] });

    expect(context.pixSituation).toBe("DESTINATARIO_ERRADO");
  });

  it("выдуманная ситуация не принимается", async () => {
    await marcarPix();
    const response = await informarSituacao("DEVOLUCAO_AUTOMATICA");

    expect(response.status).toBe(404);
    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.pixSituation).toBeNull();
  });

  it("не записывается, если платили не через Pix", async () => {
    const response = await informarSituacao("GOLPE_FRAUDE");

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.pixSituation).toBeNull();
    expect(decodeURIComponent(response.headers.location ?? "")).toContain("Pix");
  });

  it("ситуацию можно изменить", async () => {
    await marcarPix();
    await informarSituacao("DISPUTA_COMERCIAL");
    await informarSituacao("GOLPE_FRAUDE");

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.pixSituation).toBe("GOLPE_FRAUDE");
  });
});
