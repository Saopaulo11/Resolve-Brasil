import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { resetConfigCache } = await import("../../src/config/env");
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

describe("подсказка про строку подключения", () => {
  const ANTES = { ...process.env };

  afterEach(() => {
    process.env = { ...ANTES };
    resetConfigCache();
  });

  it("узнаёт прямой хост Supabase и называет лечение", async () => {
    // Прямой хост существует только в IPv6, а исходящего IPv6 у функций
    // нет. В логах базы при этом не появляется ни одной попытки входа, и
    // отказ выглядит как неверный пароль — его ищут часами.
    process.env.DATABASE_URL =
      "postgresql://postgres:SenhaReal@db.yybexvdznczbobsibtyn.supabase.co:5432/postgres";
    resetConfigCache();

    const resposta = await request(createHarness().app).get("/health");
    const detalhe = resposta.body.checks.database.detail as string;

    expect(detalhe).toContain("conexão direta");
    expect(detalhe).toContain("Transaction pooler");
    expect(detalhe).toContain("6543");
    // Хост назван — он и так виден в сообщении драйвера. Пароль нет.
    expect(detalhe).toContain("db.yybexvdznczbobsibtyn.supabase.co");
    expect(detalhe).not.toContain("SenhaReal");
  });

  it("молчит, когда строка уже через пул", async () => {
    process.env.DATABASE_URL =
      "postgresql://postgres.abc:SenhaReal@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";
    resetConfigCache();

    const resposta = await request(createHarness().app).get("/health");
    const detalhe = resposta.body.checks.database.detail as string;

    expect(detalhe).not.toContain("Transaction pooler");
  });
});
