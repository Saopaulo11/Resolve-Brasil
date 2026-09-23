import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildCaseContext } from "../../src/ai/context";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Штат дела (§57).
 *
 * Procon у каждого штата свой, и без штата на вопрос «куда идти» ответить
 * нельзя. Города при этом нет и не будет: вместе с суммой, категорией и
 * месяцем он опознаёт человека не хуже имени (§55).
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
    .send({ _csrf: home.token, description: "Comprei e não recebi o produto." });

  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

async function informarEstado(estado: string) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/estado`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, estado });
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

describe("выбор штата", () => {
  it("сохраняется и показывается в сводке", async () => {
    const response = await informarEstado("SP");
    expect(response.status).toBe(303);

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.state).toBe("SP");

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("São Paulo");
  });

  it("необязателен", async () => {
    // «Prefiro não informar» — законный ответ, а не ошибка формы.
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Prefiro não informar");
    expect(page.text).toContain("Não informado");
  });

  it("выдуманный код не принимается", async () => {
    const response = await informarEstado("XX");
    expect(response.status).toBe(404);

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.state).toBeNull();
  });

  it("уходит модели: Procon у каждого штата свой", async () => {
    await informarEstado("RJ");

    const caso = await harness.cases.findByPublicId(publicId);
    const context = buildCaseContext({ case: caso!, timeline: [] });
    expect(context.state).toBe("RJ");
  });

  it("город не спрашивается вовсе", async () => {
    // §55: город вместе с суммой и категорией опознаёт человека не хуже
    // имени, а для выбора канала он не нужен.
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).not.toMatch(/name="cidade"/);
    expect(page.text).toContain("Não perguntamos sua cidade");
  });

  it("попадает в аналитику", async () => {
    await informarEstado("MG");

    const [slice] = await harness.analytics.listReal();
    expect(slice?.state).toBe("MG");
    // Город остаётся пустым: его никто не спрашивал.
    expect(slice?.cityBucket).toBeNull();
  });
});
