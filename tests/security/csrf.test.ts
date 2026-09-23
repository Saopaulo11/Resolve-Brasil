import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

describe("защита от CSRF", () => {
  it("отклоняет POST без токена", async () => {
    const response = await request(app)
      .post("/caso/novo")
      .type("form")
      .send({ description: "Comprei um produto e não recebi até hoje, já faz um mês." });

    expect(response.status).toBe(403);
  });

  it("отклоняет POST с чужим токеном", async () => {
    const page = await request(app).get("/");
    const cookies = page.headers["set-cookie"] as unknown as string[];

    const response = await request(app)
      .post("/caso/novo")
      .set("Cookie", cookies)
      .type("form")
      .send({
        _csrf: "token-de-outro-site",
        description: "Comprei um produto e não recebi até hoje, já faz um mês.",
      });

    expect(response.status).toBe(403);
  });

  it("отклоняет токен без соответствующей куки", async () => {
    // Токен есть, куки нет — ровно то, что может подделать сторонний сайт.
    const page = await request(app).get("/");
    const token = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1] ?? "";

    const response = await request(app)
      .post("/caso/novo")
      .type("form")
      .send({
        _csrf: token,
        description: "Comprei um produto e não recebi até hoje, já faz um mês.",
      });

    expect(response.status).toBe(403);
  });

  it("объясняет отказ по-человечески, без технических подробностей", async () => {
    const response = await request(app)
      .post("/caso/novo")
      .type("form")
      .send({ description: "Comprei um produto e não recebi até hoje, já faz um mês." });

    expect(response.text).toContain("Sessão expirada");
    expect(response.text).not.toContain("CSRF_TOKEN_INVALIDO");
  });
});
