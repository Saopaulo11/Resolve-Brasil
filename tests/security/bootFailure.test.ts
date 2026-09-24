import { afterEach, describe, expect, it } from "vitest";

import { corpoDaFalha, limparMensagem } from "../../src/boot/failureServer";

/**
 * Страница отказа при несостоявшемся запуске открыта всем — она отдаётся до
 * того, как поднялось хоть что-то из приложения. Значит в неё нельзя пускать
 * ничего, кроме причины: сообщение драйвера базы приходит вместе со строкой
 * подключения, ответ провайдера ИИ — вместе с ключом (§6, §41).
 */
describe("сообщение о сбое запуска", () => {
  it("не выносит наружу строку подключения к базе", () => {
    const texto = limparMensagem(
      new Error(
        "connect ECONNREFUSED postgresql://postgres.abc:SenhaSecreta123@" +
          "aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
      ),
    );

    expect(texto).not.toContain("SenhaSecreta123");
    expect(texto).not.toContain("supabase.com");
    expect(texto).toContain("[redigido]");
    // Сама причина при этом остаётся читаемой.
    expect(texto).toContain("ECONNREFUSED");
  });

  it("не выносит наружу ключ провайдера", () => {
    const chave = `sk-proj-${"A".repeat(40)}`;
    const texto = limparMensagem(new Error(`Incorrect API key provided: ${chave}`));

    expect(texto).not.toContain(chave);
    expect(texto).toContain("[redigido]");
  });

  it("не разрастается до простыни", () => {
    expect(limparMensagem(new Error("x".repeat(5000))).length).toBeLessThanOrEqual(300);
  });

  it("сохраняет причину, в которой нечего прятать", () => {
    expect(limparMensagem(new Error("Cannot find module './dist/server.js'"))).toBe(
      "Cannot find module './dist/server.js'",
    );
  });
});

describe("страница отказа", () => {
  const ANTES = { ...process.env };

  afterEach(() => {
    process.env = { ...ANTES };
  });

  it("называет переменные по именам и не показывает значений", () => {
    process.env.SESSION_SECRET = "valor-que-nao-deve-aparecer-em-lugar-nenhum";
    delete process.env.APP_URL;

    const corpo = corpoDaFalha(new Error("faltou configuração"));

    expect(corpo).toContain("SESSION_SECRET: definida");
    expect(corpo).toContain("APP_URL: AUSENTE");
    expect(corpo).not.toContain("valor-que-nao-deve-aparecer");
  });
});
