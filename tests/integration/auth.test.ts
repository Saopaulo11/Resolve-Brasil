import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

describe("вход по телефону и коду", () => {
  it("проходит весь путь и открывает личный кабинет", async () => {
    const cookies = await login(harness, "11987654321");

    const account = await request(harness.app).get("/minha-conta").set("Cookie", cookies);
    expect(account.status).toBe(200);
    expect(account.text).toContain("Minha conta");
    expect(account.text).toContain("Meus casos");
  });

  it("создаёт пользователя с подтверждённым телефоном", async () => {
    await login(harness, "11987654321");

    const user = await harness.users.findByPhone("+5511987654321");
    expect(user).not.toBeNull();
    expect(user?.phoneVerified).toBe(true);
  });

  it("повторный вход не создаёт второго пользователя", async () => {
    await login(harness, "11987654321");
    const first = await harness.users.findByPhone("+5511987654321");

    await login(harness, "(11) 98765-4321");
    const second = await harness.users.findByPhone("+5511987654321");

    // Разная запись номера не должна порождать вторую учётную запись.
    expect(second?.id).toBe(first?.id);
  });

  it("отклоняет неверный телефон, не отправляя кода", async () => {
    const start = await openPage(harness.app, "/entrar");

    const response = await request(harness.app)
      .post("/entrar")
      .set("Cookie", start.cookies)
      .type("form")
      .send({ _csrf: start.token, phone: "20987654321" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("DDD inválido");
    expect(harness.otpProvider.sent).toHaveLength(0);
  });

  it("без сессии личный кабинет ведёт на вход", async () => {
    const response = await request(harness.app).get("/minha-conta");
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/entrar");
  });

  it("страница кода без начатого входа возвращает на первый шаг", async () => {
    const response = await request(harness.app).get("/entrar/codigo");
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/entrar");
  });

  it("выход отзывает сессию", async () => {
    const cookies = await login(harness, "11987654321");
    const page = await openPage(harness.app, "/minha-conta", cookies);

    await request(harness.app)
      .post("/sair")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    // Та же кука после выхода больше не пускает: сессия отозвана в хранилище.
    const after = await request(harness.app).get("/minha-conta").set("Cookie", cookies);
    expect(after.status).toBe(302);
  });
});

describe("согласия при регистрации (§17, §63)", () => {
  it("фиксирует условия и приватность", async () => {
    await login(harness, "11987654321");

    const types = harness.consents.records.map((record) => record.type);
    expect(types).toContain("TERMS");
    expect(types).toContain("PRIVACY");
  });

  it("у каждого согласия есть версия документа", async () => {
    await login(harness, "11987654321");
    for (const record of harness.consents.records) {
      expect(record.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("без галочки маркетинг остаётся выключенным", async () => {
    // Регистрация по телефону не означает согласия на рассылку.
    await login(harness, "11987654321");

    const user = await harness.users.findByPhone("+5511987654321");
    expect(user?.marketingConsent).toBe(false);
    expect(user?.marketingNotifications).toBe(false);

    const marketing = harness.consents.records.filter((r) => r.type === "MARKETING");
    expect(marketing).toHaveLength(1);
    expect(marketing[0]?.accepted).toBe(false);
  });

  it("с галочкой маркетинг включается и записывается отдельно", async () => {
    await login(harness, "11987654321", { marketing: true });

    const user = await harness.users.findByPhone("+5511987654321");
    expect(user?.marketingConsent).toBe(true);

    const marketing = harness.consents.records.filter((r) => r.type === "MARKETING");
    expect(marketing[0]?.accepted).toBe(true);
  });

  it("отписка не трогает уведомления по делу", async () => {
    const cookies = await login(harness, "11987654321", { marketing: true });
    const page = await openPage(harness.app, "/minha-conta", cookies);

    await request(harness.app)
      .post("/marketing/unsubscribe")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    const user = await harness.users.findByPhone("+5511987654321");
    expect(user?.marketingConsent).toBe(false);
    // Сервисные уведомления — часть услуги, отписка от рассылки их не снимает.
    expect(user?.caseNotifications).toBe(true);
    expect(user?.marketingUnsubscribedAt).not.toBeNull();
  });

  it("отписка сохраняется отдельной записью согласия", async () => {
    const cookies = await login(harness, "11987654321", { marketing: true });
    const page = await openPage(harness.app, "/minha-conta", cookies);

    await request(harness.app)
      .post("/marketing/unsubscribe")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    // Доказательством отписки служит запись о ней, а не отсутствие записи.
    const marketing = harness.consents.records.filter((r) => r.type === "MARKETING");
    expect(marketing.at(-1)?.accepted).toBe(false);
  });
});

describe("шапка сайта", () => {
  it("гостю предлагает войти", async () => {
    const response = await request(harness.app).get("/");
    expect(response.text).toContain(">Entrar<");
  });

  it("вошедшему показывает личный кабинет", async () => {
    const cookies = await login(harness, "11987654321");
    const response = await request(harness.app).get("/").set("Cookie", cookies);
    expect(response.text).toContain(">Minha conta<");
  });
});

describe("вспомогательное", () => {
  it("склейка кук перекрывает старое значение новым", () => {
    const merged = mergeCookies(["a=1; Path=/"], ["a=2; Path=/", "b=3"]);
    expect(merged).toContain("a=2");
    expect(merged).toContain("b=3");
    expect(merged.filter((c) => c.startsWith("a="))).toHaveLength(1);
  });
});
