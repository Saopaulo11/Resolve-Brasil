import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/createApp";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

describe("заголовки безопасности", () => {
  it("ставит строгую CSP без unsafe-inline", async () => {
    const response = await request(app).get("/");
    const csp = response.headers["content-security-policy"] ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Как только появится 'unsafe-inline', CSP перестанет защищать от XSS.
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("запрещает угадывание типа содержимого", async () => {
    const response = await request(app).get("/");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("не раскрывает используемый фреймворк", async () => {
    const response = await request(app).get("/");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("не отдаёт полный путь на сторонние сайты", async () => {
    const response = await request(app).get("/");
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("страницы не содержат инлайновых скриптов — иначе CSP их заблокирует", async () => {
    const response = await request(app).get("/");
    expect(response.text).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });

  it("кука CSRF недоступна скриптам", async () => {
    const response = await request(app).get("/");
    const cookies = (response.headers["set-cookie"] as unknown as string[]) ?? [];
    const csrf = cookies.find((cookie) => cookie.startsWith("rb_csrf="));
    expect(csrf).toBeDefined();
    expect(csrf).toContain("HttpOnly");
    expect(csrf).toContain("SameSite=Lax");
  });
});
