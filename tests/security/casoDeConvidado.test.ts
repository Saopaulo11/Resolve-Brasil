import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";

/**
 * Дело видно тому, кто его завёл, ещё до входа (§15).
 *
 * Смысл правки: человек рассказал о проблеме и должен увидеть разбор.
 * Телефон нужен, чтобы дело сохранилось и приходили напоминания, — и
 * спрашивать его раньше, чем показана польза, значит терять людей у стены.
 *
 * Здесь проверяется не удобство, а границы: доступ даёт подписанная кука с
 * ровно одним номером дела, и он пропадает, как только у дела появляется
 * владелец. Иначе на общем телефоне следующий человек увидел бы чужое дело.
 */

let harness: Harness;

const RELATO =
  "Comprei um produto pela internet, paguei via Pix e ate hoje nao recebi.";

beforeEach(() => {
  harness = createHarness();
});

/** Заводит дело гостем и отдаёт куки вместе с номером. */
async function casoDeConvidado(relato = RELATO) {
  const home = await openPage(harness.app, "/");
  const criado = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: relato });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(criado.headers.location ?? "")?.[1];
  if (!publicId) throw new Error("дело не создано: " + criado.headers.location);

  const cookies = mergeCookies(
    home.cookies,
    (criado.headers["set-cookie"] as unknown as string[]) ?? [],
  );
  return { publicId, cookies, criado };
}

describe("гость и его собственное дело", () => {
  it("после рассказа ведёт на дело, а не на форму телефона", async () => {
    const { criado, publicId } = await casoDeConvidado();

    expect(criado.status).toBe(303);
    expect(criado.headers.location).toBe(`/caso/${publicId}`);
    expect(criado.headers.location).not.toContain("/entrar");
  });

  it("страница дела открывается и зовёт сохранить его", async () => {
    const { publicId, cookies } = await casoDeConvidado();

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain(publicId);
    // Кука живёт полчаса: сказать об этом нужно до того, как он уйдёт.
    expect(pagina.text).toContain("ainda não está salvo");
  });

  it("без куки то же дело не показывается", async () => {
    const { publicId } = await casoDeConvidado();

    const semCookie = await request(harness.app).get(`/caso/${publicId}`);

    expect(semCookie.status).toBe(303);
    expect(semCookie.headers.location).toContain("/entrar");
  });

  it("кука одного дела не открывает другое", async () => {
    // Самое важное: кука несёт ровно один номер, а не право на все дела.
    const primeiro = await casoDeConvidado();
    const segundo = await casoDeConvidado("Outro caso completamente diferente aqui.");

    const cruzado = await request(harness.app)
      .get(`/caso/${segundo.publicId}`)
      .set("Cookie", primeiro.cookies);

    expect(cruzado.status).toBe(303);
    expect(cruzado.headers.location).toContain("/entrar");
  });

  it("как только у дела есть владелец, кука к нему не пускает", async () => {
    /*
     * Общий телефон: один человек завёл дело и вошёл, второй берёт тот же
     * браузер. Старая кука не должна открывать ему чужое дело.
     */
    const { publicId, cookies } = await casoDeConvidado();

    // Вход привязывает дело к человеку.
    await login(harness, "11987654321", { cookies });

    const depois = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies.filter((c) => !c.startsWith("rb_sessao")));

    expect(depois.status).toBe(303);
    expect(depois.headers.location).toContain("/entrar");
  });

  it("разбор запускается и без входа", async () => {
    // Ради него человек и пришёл; без этого страница дела пустая.
    const { publicId, cookies } = await casoDeConvidado();
    const pagina = await openPage(harness.app, `/caso/${publicId}`, cookies);

    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, tipo: "classificar" });

    expect(resposta.status).toBe(303);
    // Провайдер не настроен в тестах — но это отказ разбора, а не отказ
    // доступа: на вход бы увело.
    expect(resposta.headers.location).toContain(`/caso/${publicId}`);
    expect(resposta.headers.location).not.toContain("/entrar");
  });

  it("чужое дело разобрать нельзя", async () => {
    const primeiro = await casoDeConvidado();
    const segundo = await casoDeConvidado("Outro caso completamente diferente aqui.");
    const pagina = await openPage(harness.app, `/caso/${primeiro.publicId}`, primeiro.cookies);

    const resposta = await request(harness.app)
      .post(`/caso/${segundo.publicId}/analisar`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, tipo: "classificar" });

    expect(resposta.status).toBe(404);
  });
});
