import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

/** Достаёт CSRF-токен и куку с главной — как это делает браузер. */
async function openForm() {
  const response = await request(app).get("/");
  const token = /name="_csrf" value="([^"]+)"/.exec(response.text)?.[1] ?? "";
  const cookies = response.headers["set-cookie"] as unknown as string[];
  return { token, cookies };
}

describe("приём описания случая", () => {
  it("принимает осмысленное описание", async () => {
    const { token, cookies } = await openForm();

    const response = await request(app)
      .post("/caso/novo")
      .set("Cookie", cookies)
      .type("form")
      .send({
        _csrf: token,
        description:
          "Comprei um fone de ouvido, paguei no Pix em 10/09 e até hoje não recebi.",
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain("Entendemos sua situação");
  });

  it("не выдаёт анализа, которого не было", async () => {
    // §9, §82: правдоподобная заглушка неотличима от ответа модели.
    const { token, cookies } = await openForm();

    const response = await request(app)
      .post("/caso/novo")
      .set("Cookie", cookies)
      .type("form")
      .send({
        _csrf: token,
        description: "Paguei por um serviço que nunca foi realizado, faz duas semanas.",
      });

    expect(response.text).toContain("Em construção");
    expect(response.text).not.toMatch(/você tem direito garantido|certamente/i);
  });

  it("отклоняет слишком короткое описание и возвращает текст в форму", async () => {
    const { token, cookies } = await openForm();

    const response = await request(app)
      .post("/caso/novo")
      .set("Cookie", cookies)
      .type("form")
      .send({ _csrf: token, description: "oi" });

    expect(response.status).toBe(400);
    expect(response.text).toContain("Conte um pouco mais");
    // Заставлять человека заново набирать рассказ — верный способ его потерять.
    expect(response.text).toContain("oi</textarea>");
  });

  it("экранирует пользовательский текст", async () => {
    const { token, cookies } = await openForm();

    const response = await request(app)
      .post("/caso/novo")
      .set("Cookie", cookies)
      .type("form")
      .send({
        _csrf: token,
        description:
          "<script>alert('xss')</script> Comprei e paguei mas nunca recebi o produto.",
      });

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("<script>alert");
    expect(response.text).toContain("&lt;script&gt;");
  });
});
