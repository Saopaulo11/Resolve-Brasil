import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

const DESCRIPTION =
  "Comprei um fone de ouvido, paguei no Pix em 10/09 e até hoje não recebi.";

/** Отправляет описание с главной. Куки — чьи переданы (гость или вошедший). */
async function submitCase(cookies: string[] = [], description = DESCRIPTION) {
  const home = await openPage(harness.app, "/", cookies);
  const response = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description });

  return {
    response,
    cookies: mergeCookies(
      home.cookies,
      (response.headers["set-cookie"] as unknown as string[]) ?? [],
    ),
  };
}

describe("создание дела вошедшим пользователем", () => {
  it("ведёт прямо на страницу дела", async () => {
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(session);

    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^\/caso\/RB-[A-Z2-9]{6}$/);
  });

  it("страница дела показывает рассказ пользователя и хронологию", async () => {
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(session);

    const page = await request(harness.app)
      .get(response.headers.location ?? "")
      .set("Cookie", session);

    expect(page.status).toBe(200);
    expect(page.text).toContain(DESCRIPTION);
    expect(page.text).toContain("Linha do tempo");
    expect(page.text).toContain("Caso registrado");
  });

  it("не выдаёт анализа, которого не было", async () => {
    // §9, §82: правдоподобная заглушка неотличима от ответа модели.
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(session);

    const page = await request(harness.app)
      .get(response.headers.location ?? "")
      .set("Cookie", session);

    expect(page.text).toContain("Em construção");
    expect(page.text).not.toMatch(/você tem direito garantido|certamente vai ganhar/i);
  });

  it("дело появляется в личном кабинете", async () => {
    const session = await login(harness, "11987654321");
    await submitCase(session);

    const account = await request(harness.app).get("/minha-conta").set("Cookie", session);
    expect(account.status).toBe(200);
    expect(account.text).toContain("Ainda não classificado");
    expect(account.text).toContain("Novo");
    expect(account.text).not.toContain("Você ainda não tem casos");
  });

  it("экранирует пользовательский текст", async () => {
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(
      session,
      "<script>alert('xss')</script> Comprei e paguei mas nunca recebi o produto.",
    );

    const page = await request(harness.app)
      .get(response.headers.location ?? "")
      .set("Cookie", session);

    expect(page.text).not.toContain("<script>alert");
    expect(page.text).toContain("&lt;script&gt;");
  });

  it("отклоняет слишком короткое описание и возвращает текст в форму", async () => {
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(session, "oi");

    expect(response.status).toBe(400);
    expect(response.text).toContain("Conte um pouco mais");
    // Заставлять человека заново набирать рассказ — верный способ его потерять.
    expect(response.text).toContain("oi</textarea>");
  });
});

describe("создание дела до входа (§15)", () => {
  it("ведёт на вход, сохранив дело", async () => {
    const { response } = await submitCase();

    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^\/entrar\?next=/);
  });

  it("после входа дело становится делом этого пользователя", async () => {
    const guest = await submitCase();

    // Тот же браузер: куки гостя несут номер начатого дела.
    const session = await login(harness, "11987654321", { cookies: guest.cookies });

    const account = await request(harness.app).get("/minha-conta").set("Cookie", session);
    expect(account.text).not.toContain("Você ainda não tem casos");
    expect(account.text).toContain("Novo");
  });

  it("после входа сразу открывает начатое дело", async () => {
    const guest = await submitCase();
    const session = await login(harness, "11987654321", { cookies: guest.cookies });

    const account = await request(harness.app).get("/minha-conta").set("Cookie", session);
    const match = /\/caso\/(RB-[A-Z2-9]{6})/.exec(account.text);
    expect(match).not.toBeNull();

    const page = await request(harness.app)
      .get(`/caso/${match?.[1]}`)
      .set("Cookie", session);
    expect(page.status).toBe(200);
    expect(page.text).toContain(DESCRIPTION);
  });
});
