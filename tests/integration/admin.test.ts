import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/admin/password";
import type { AdminRole } from "../../src/generated/prisma/enums";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, openPage, mergeCookies, type Harness } from "../helpers/auth";

let harness: Harness;

const EMAIL = "admin@exemplo.com";
const PASSWORD = "senha-forte-para-teste-2026";

async function criarAdmin(role: AdminRole = "ADMIN", email = EMAIL) {
  return harness.admins.create({
    email,
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
}

/** Вход в админку. Возвращает куки админской сессии. */
async function entrar(email = EMAIL, senha = PASSWORD): Promise<string[]> {
  const page = await openPage(harness.app, "/admin/entrar");
  const response = await request(harness.app)
    .post("/admin/entrar")
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, email, senha });

  return mergeCookies(
    page.cookies,
    (response.headers["set-cookie"] as unknown as string[]) ?? [],
  );
}

beforeEach(() => {
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  resetConfigCache();
});

describe("вход в админку (§51)", () => {
  it("пускает с верными данными", async () => {
    await criarAdmin();
    const cookies = await entrar();

    const painel = await request(harness.app).get("/admin").set("Cookie", cookies);
    expect(painel.status).toBe(200);
    expect(painel.text).toContain("Painel");
  });

  it("не пускает с неверным паролем", async () => {
    await criarAdmin();
    const cookies = await entrar(EMAIL, "senha-errada-qualquer-2026");

    const painel = await request(harness.app).get("/admin").set("Cookie", cookies);
    expect(painel.status).toBe(303);
  });

  it("не отвечает, заведён ли такой администратор", async () => {
    // Разные сообщения превратили бы форму входа в проверку списка админов.
    await criarAdmin();

    const page = await openPage(harness.app, "/admin/entrar");
    const existente = await request(harness.app)
      .post("/admin/entrar")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, email: EMAIL, senha: "errada-mas-longa-2026" });

    const page2 = await openPage(harness.app, "/admin/entrar");
    const inexistente = await request(harness.app)
      .post("/admin/entrar")
      .set("Cookie", page2.cookies)
      .type("form")
      .send({ _csrf: page2.token, email: "ninguem@exemplo.com", senha: "errada-mas-longa-2026" });

    expect(existente.status).toBe(inexistente.status);
    expect(existente.text).toContain("E-mail ou senha inválidos");
    expect(inexistente.text).toContain("E-mail ou senha inválidos");
  });

  it("блокирует после серии неудач (§66)", async () => {
    await criarAdmin();

    for (let i = 0; i < 5; i += 1) {
      await entrar(EMAIL, `errada-${i}-mas-longa-2026`);
    }

    const page = await openPage(harness.app, "/admin/entrar");
    const response = await request(harness.app)
      .post("/admin/entrar")
      .set("Cookie", page.cookies)
      .type("form")
      // Даже верный пароль теперь не проходит: иначе лимит ничего не значил бы.
      .send({ _csrf: page.token, email: EMAIL, senha: PASSWORD });

    expect(response.text).toContain("Muitas tentativas");
  });

  it("отключённый администратор теряет доступ немедленно", async () => {
    const admin = await criarAdmin();
    const cookies = await entrar();

    admin.active = false;

    const painel = await request(harness.app).get("/admin").set("Cookie", cookies);
    expect(painel.status).toBe(303);
  });

  it("выход отзывает сессию", async () => {
    await criarAdmin();
    const cookies = await entrar();
    const page = await openPage(harness.app, "/admin", cookies);

    await request(harness.app)
      .post("/admin/sair")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    const painel = await request(harness.app).get("/admin").set("Cookie", cookies);
    expect(painel.status).toBe(303);
  });

  it("кука админки не уходит на публичные страницы", async () => {
    // Path ограничен /admin: на витрине она не нужна и не должна там быть.
    await criarAdmin();
    const page = await openPage(harness.app, "/admin/entrar");
    const response = await request(harness.app)
      .post("/admin/entrar")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, email: EMAIL, senha: PASSWORD });

    const setCookie = (response.headers["set-cookie"] as unknown as string[]) ?? [];
    const admin = setCookie.find((c) => c.startsWith("rb_admin="));

    expect(admin).toBeDefined();
    expect(admin).toContain("Path=/admin");
    expect(admin).toContain("HttpOnly");
    expect(admin).toContain("SameSite=Strict");
  });

  it("без входа админка закрыта", async () => {
    for (const path of ["/admin", "/admin/casos", "/admin/analytics", "/admin/auditoria"]) {
      const response = await request(harness.app).get(path);
      expect(response.status, path).toBe(303);
      expect(response.headers.location).toBe("/admin/entrar");
    }
  });
});

describe("разграничение прав (§51)", () => {
  it("минимальная роль видит только сводку", async () => {
    await criarAdmin("VIEWER");
    const cookies = await entrar();

    expect((await request(harness.app).get("/admin").set("Cookie", cookies)).status).toBe(200);

    for (const path of ["/admin/casos", "/admin/analytics", "/admin/auditoria"]) {
      const response = await request(harness.app).get(path).set("Cookie", cookies);
      expect(response.status, path).toBe(403);
    }
  });

  it("аналитик не видит дел", async () => {
    await criarAdmin("ANALYST");
    const cookies = await entrar();

    expect(
      (await request(harness.app).get("/admin/analytics").set("Cookie", cookies)).status,
    ).toBe(200);
    expect(
      (await request(harness.app).get("/admin/casos").set("Cookie", cookies)).status,
    ).toBe(403);
  });

  it("поддержка не видит журнала доступа", async () => {
    await criarAdmin("SUPPORT");
    const cookies = await entrar();

    expect(
      (await request(harness.app).get("/admin/casos").set("Cookie", cookies)).status,
    ).toBe(200);
    expect(
      (await request(harness.app).get("/admin/auditoria").set("Cookie", cookies)).status,
    ).toBe(403);
  });

  it("отказ в доступе попадает в журнал", async () => {
    // Попытка выйти за пределы роли — само по себе событие.
    await criarAdmin("VIEWER");
    const cookies = await entrar();

    await request(harness.app).get("/admin/casos").set("Cookie", cookies);

    const denied = harness.audit.entries.filter((e) => e.action === "admin.access.denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.entityId).toBe("cases.list");
  });
});

describe("журнал обращений (§51)", () => {
  it("просмотр дел записывается", async () => {
    await criarAdmin("SUPPORT");
    const cookies = await entrar();

    await request(harness.app).get("/admin/casos").set("Cookie", cookies);

    const accesses = harness.audit.entries.filter((e) => e.action === "admin.access");
    expect(accesses).toHaveLength(1);
    expect(accesses[0]?.entityId).toBe("cases.list");
    expect(accesses[0]?.adminUserId).not.toBeNull();
  });

  it("просмотр сводки журнал не засоряет", async () => {
    // Сводка из обезличенных чисел не требует записи, а поток таких
    // записей утопил бы то, ради чего журнал заведён.
    await criarAdmin("ADMIN");
    const cookies = await entrar();

    harness.audit.entries.length = 0;
    await request(harness.app).get("/admin").set("Cookie", cookies);

    expect(harness.audit.entries).toHaveLength(0);
  });
});

describe("что видно в админке", () => {
  it("список дел не показывает рассказа, телефона и документов", async () => {
    const cookies = await entrar_com_caso();

    const response = await request(harness.app).get("/admin/casos").set("Cookie", cookies);

    expect(response.status).toBe(200);
    expect(response.text).toContain("RB-");
    // §51: показанное однажды показано навсегда.
    expect(response.text).not.toContain("paguei no Pix");
    expect(response.text).not.toContain("+5511987654321");
    expect(response.text).not.toContain("11987654321");
  });

  async function entrar_com_caso(): Promise<string[]> {
    const { login } = await import("../helpers/auth");
    const userCookies = await login(harness, "11987654321");
    const home = await openPage(harness.app, "/", userCookies);
    await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({
        _csrf: home.token,
        description: "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.",
      });

    await criarAdmin("SUPPORT");
    return entrar();
  }
});
