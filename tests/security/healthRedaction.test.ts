import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /health открыт без входа — иначе он не годится как проверка снаружи.
 * Значит всё, что он печатает, печатается всему интернету. А печатает он
 * сообщение драйвера базы, и в нём приезжает строка подключения целиком:
 * пользователь, пароль, хост (§6, §41).
 */
const DSN =
  "postgresql://postgres.yybexvdznczbobsibtyn:SenhaDeVerdade123@" +
  "aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

vi.mock("../../src/services/db", () => ({
  isDatabaseConfigured: () => true,
  db: () => {
    throw new Error(`connect ECONNREFUSED ${DSN}`);
  },
  disconnectDb: async () => undefined,
}));

const { createHarness } = await import("../helpers/auth");

let app: ReturnType<typeof createHarness>["app"];

beforeEach(() => {
  app = createHarness().app;
});

describe("GET /health при недоступной базе", () => {
  it("называет причину, но не выдаёт строку подключения", async () => {
    const resposta = await request(app).get("/health");

    expect(resposta.status).toBe(503);
    expect(resposta.body.checks.database.ok).toBe(false);

    const corpo = JSON.stringify(resposta.body);
    expect(corpo).not.toContain("SenhaDeVerdade123");
    expect(corpo).not.toContain("pooler.supabase.com");
    expect(corpo).toContain("[redigido]");
    // Причина при этом остаётся различимой.
    expect(corpo).toContain("ECONNREFUSED");
  });
});
