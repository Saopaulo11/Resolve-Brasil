import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

const DESCRIPTION = "Paguei por um serviço que nunca foi realizado, faz duas semanas.";

/** Создаёт дело от имени вошедшего и возвращает его публичный номер. */
async function createCaseAs(cookies: string[]): Promise<string> {
  const home = await openPage(harness.app, "/", cookies);
  const response = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });

  const location = response.headers.location ?? "";
  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(location)?.[1];
  if (!publicId) throw new Error(`Дело не создано: ${location}`);
  return publicId;
}

describe("доступ к делу (§80)", () => {
  it("чужое дело не открывается", async () => {
    const alice = await login(harness, "11987654321");
    const publicId = await createCaseAs(alice);

    const bob = await login(harness, "21987654321");
    const response = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", bob);

    expect(response.status).toBe(404);
    expect(response.text).not.toContain(DESCRIPTION);
  });

  it("чужое и несуществующее дело неотличимы", async () => {
    // 403 на чужом деле подтвердил бы, что такой номер существует, и
    // публичные номера стали бы способом проверять их наличие перебором.
    const alice = await login(harness, "11987654321");
    const publicId = await createCaseAs(alice);

    const bob = await login(harness, "21987654321");

    const foreign = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", bob);
    const missing = await request(harness.app)
      .get("/caso/RB-ZZZZZZ")
      .set("Cookie", bob);

    expect(foreign.status).toBe(missing.status);
    expect(foreign.status).toBe(404);
  });

  it("без входа дело не открывается", async () => {
    const alice = await login(harness, "11987654321");
    const publicId = await createCaseAs(alice);

    // Дело Алисы уже принадлежит ей, и кук у этого запроса нет вовсе:
    // права на просмотр не даёт ничто.
    const response = await request(harness.app).get(`/caso/${publicId}`);
    expect([302, 303]).toContain(response.status);
    expect(response.headers.location).toContain("/entrar");
  });

  it("мусор вместо номера даёт 404, а не ошибку сервера", async () => {
    const alice = await login(harness, "11987654321");

    for (const bad of ["RB-000000", "../../etc/passwd", "RB-abc", "%00"]) {
      const response = await request(harness.app)
        .get(`/caso/${encodeURIComponent(bad)}`)
        .set("Cookie", alice);
      expect(response.status, bad).toBe(404);
    }
  });

  it("чужой номер в куке не присваивает дело при входе", async () => {
    // Дело уже принадлежит Алисе; Боб входит с её номером в куке.
    const alice = await login(harness, "11987654321");
    const publicId = await createCaseAs(alice);

    const forged = mergeCookies([], [`rb_caso=${publicId}`]);
    const bob = await login(harness, "21987654321", { cookies: forged });

    const response = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", bob);
    expect(response.status).toBe(404);

    // И дело по-прежнему открывается у Алисы.
    const original = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", alice);
    expect(original.status).toBe(200);
  });

  it("список дел показывает только свои", async () => {
    const alice = await login(harness, "11987654321");
    await createCaseAs(alice);

    const bob = await login(harness, "21987654321");
    const account = await request(harness.app).get("/minha-conta").set("Cookie", bob);

    expect(account.text).toContain("Você ainda não tem casos");
  });
});

describe("публичный номер дела", () => {
  it("у двух дел номера разные", async () => {
    const alice = await login(harness, "11987654321");
    const first = await createCaseAs(alice);
    const second = await createCaseAs(alice);
    expect(first).not.toBe(second);
  });

  it("номер не последовательный", async () => {
    const alice = await login(harness, "11987654321");
    const ids = [
      await createCaseAs(alice),
      await createCaseAs(alice),
      await createCaseAs(alice),
    ];
    // По номеру не должно быть видно, сколько дел в системе.
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).not.toMatch(/RB-0{4}/);
  });
});
