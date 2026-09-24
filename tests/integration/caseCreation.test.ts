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

    // Ни категории, ни уверенности, ни плана — ничего не анализировалось.
    expect(page.text).not.toContain("Entendemos sua situação");
    expect(page.text).not.toContain("Plano de ação</h3>");
    expect(page.text).not.toMatch(/você tem direito garantido|certamente vai ganhar/i);
    // Дисклеймер AI тоже не показывается: показывать его не под чем.
    expect(page.text).not.toContain("Informação gerada por inteligência artificial");
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

  it("отвечает по-португальски, когда поля с рассказом нет вовсе", async () => {
    // required у textarea живёт в браузере. POST приходит откуда угодно, и
    // тогда сообщение писал бы уже zod: по-английски и про типы данных.
    const session = await login(harness, "11987654321");
    const home = await openPage(harness.app, "/", session);
    const response = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Conte o que aconteceu para começarmos");
    expect(response.text).not.toMatch(/Invalid input|expected string|received undefined/);
  });
});

describe("создание дела до входа (§15)", () => {
  it("ведёт сразу на дело, не спрашивая телефон", async () => {
    // Телефон нужен, чтобы дело сохранилось и приходили напоминания, —
    // и спрашивать его раньше, чем показана польза, значит терять людей
    // у стены, за которой они ещё ничего не видели.
    const { response } = await submitCase();

    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^\/caso\/RB-[A-Z2-9]{6}/);
    expect(response.headers.location).not.toContain("/entrar");
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

describe("выбор категории на главной (§5)", () => {
  it("выбранная категория становится категорией дела", async () => {
    const session = await login(harness, "11987654321");
    const home = await openPage(harness.app, "/", session);
    const response = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({
        _csrf: home.token,
        description: DESCRIPTION,
        categoria: "produto-nao-recebido",
      });

    const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(response.headers.location ?? "")?.[1];
    const caso = await harness.cases.findByPublicId(publicId ?? "");

    expect(caso?.category).toBe("PRODUTO_NAO_RECEBIDO");
  });

  it("без выбора категория остаётся пустой — её определит анализ", async () => {
    // Заставлять человека раскладывать свою проблему по нашим ящикам нельзя:
    // он пришёл рассказать, что случилось, а не классифицировать это.
    const session = await login(harness, "11987654321");
    const { response } = await submitCase(session);

    const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(response.headers.location ?? "")?.[1];
    const caso = await harness.cases.findByPublicId(publicId ?? "");

    expect(caso?.category).toBeNull();
  });

  it("приход с карточки категории заранее отмечает её в форме", async () => {
    const pagina = await request(harness.app).get("/?categoria=cobranca-indevida");

    // Отмечен именно нужный переключатель, а не первый попавшийся.
    expect(pagina.text).toMatch(
      /id="categoria-cobranca-indevida"[^>]*\n?[^>]*checked/,
    );
    expect(pagina.text).not.toMatch(
      /id="categoria-produto-nao-recebido"[^>]*\n?[^>]*checked/,
    );
  });
});
