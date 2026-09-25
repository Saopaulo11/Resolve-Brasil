import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Чужое дело нельзя менять — ни одним из маршрутов, которые что-то пишут.
 *
 * Чтение чужого дела и чужих документов проверяется отдельно (caseAccess,
 * documentAccess). Здесь — вторая половина той же опасности: не «увидеть», а
 * «изменить». Подмена номера дела в адресе стоит ноль усилий, и каждый такой
 * маршрут обязан сверять владельца сам. Общая проверка «человек вошёл»
 * говорит только о том, что он вошёл, — чьё дело он трогает, она не знает.
 */

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

const RELATO = "Paguei por um serviço que nunca foi realizado, faz duas semanas.";

async function criarCasoDe(cookies: string[]): Promise<string> {
  const home = await openPage(harness.app, "/", cookies);
  const resposta = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: RELATO });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(resposta.headers.location ?? "")?.[1];
  if (!publicId) throw new Error(`дело не создано: ${resposta.headers.location}`);
  return publicId;
}

/** Отправка формы от имени постороннего: с его входом и его же токеном. */
async function comoOutro(
  cookies: string[],
  caminho: string,
  campos: Record<string, string>,
) {
  // Токен CSRF берётся со своей страницы: иначе запрос отвергнет проверка
  // CSRF, и мы проверили бы её, а не права доступа.
  const pagina = await openPage(harness.app, "/minha-conta", cookies);
  return request(harness.app)
    .post(caminho)
    .set("Cookie", pagina.cookies)
    .type("form")
    .send({ _csrf: pagina.token, ...campos });
}

describe("чужое дело не меняется подменой номера (§80)", () => {
  it("ни один изменяющий маршрут не пускает постороннего", async () => {
    const dono = await login(harness, "11987654321");
    const publicId = await criarCasoDe(dono);
    const estranho = await login(harness, "21987654321");

    const rotas: Array<[string, Record<string, string>]> = [
      [`/caso/${publicId}/avaliar`, { mensagem: "qualquer", avaliacao: "SIM" }],
      [`/caso/${publicId}/lembretes`, { tipo: "PRAZO", data: "2030-01-01" }],
      [`/caso/${publicId}/encerrar`, { desfecho: "resolvido" }],
      [`/caso/${publicId}/reabrir`, {}],
      [`/caso/${publicId}/escalar`, { canal: "PROCON" }],
      [`/caso/${publicId}/pix`, { situacao: "GOLPE_FRAUDE" }],
      [`/caso/${publicId}/estado`, { estado: "SP" }],
      [`/caso/${publicId}/resposta`, { texto: "resposta da empresa" }],
      [`/caso/${publicId}/analisar`, { tipo: "classificar" }],
      [`/caso/${publicId}/documentos`, {}],
    ];

    for (const [caminho, campos] of rotas) {
      const resposta = await comoOutro(estranho, caminho, campos);

      // 404 — то же, что и для несуществующего дела: по ответу нельзя
      // понять, есть ли такое дело вообще.
      expect(
        [303, 404].includes(resposta.status),
        `${caminho} ответил ${resposta.status}`,
      ).toBe(true);

      if (resposta.status === 303) {
        // Перенаправление допустимо только на вход или на свои страницы —
        // но никогда на чужое дело.
        expect(resposta.headers.location ?? "").not.toContain(publicId);
      }
      expect(resposta.text).not.toContain(RELATO);
    }
  });

  it("после всех попыток дело владельца не изменилось", async () => {
    const dono = await login(harness, "11987654321");
    const publicId = await criarCasoDe(dono);
    const antes = await harness.cases.findByPublicId(publicId);

    const estranho = await login(harness, "21987654321");
    await comoOutro(estranho, `/caso/${publicId}/encerrar`, { desfecho: "resolvido" });
    await comoOutro(estranho, `/caso/${publicId}/estado`, { estado: "SP" });
    await comoOutro(estranho, `/caso/${publicId}/pix`, { situacao: "GOLPE_FRAUDE" });

    const depois = await harness.cases.findByPublicId(publicId);
    expect(depois?.status).toBe(antes?.status);
    expect(depois?.state).toBe(antes?.state);
    expect(depois?.pixSituation).toBe(antes?.pixSituation);
    expect(depois?.userId).toBe(antes?.userId);
  });

  it("список дел постороннего не показывает чужое дело", async () => {
    const dono = await login(harness, "11987654321");
    const publicId = await criarCasoDe(dono);

    const estranho = await login(harness, "21987654321");
    const pagina = await request(harness.app)
      .get("/minha-conta")
      .set("Cookie", estranho);

    expect(pagina.text).not.toContain(publicId);
    expect(pagina.text).not.toContain(RELATO);
  });
});
