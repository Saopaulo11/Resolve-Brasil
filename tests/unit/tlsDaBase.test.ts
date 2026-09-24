import { describe, expect, it } from "vitest";

import { stripTlsParams, databaseUrlSource } from "../../src/config/databaseUrl";

/**
 * TLS вынут из строки подключения (§41).
 *
 * pg собирает настройки как Object.assign(config, parse(connectionString)):
 * разобранная строка перебивает всё, что передали явно. Значит либо TLS
 * живёт только в строке — одним словом, без оттенков, — либо строка о нём не
 * знает вовсе. Выбрано второе, и это стоит проверить: молчаливый возврат
 * параметра в строку снова отнимет управление.
 */
describe("параметры TLS в строке подключения", () => {
  it("вынимаются все известные", () => {
    const { url, removidos } = stripTlsParams(
      "postgresql://u:p@host:6543/postgres?pgbouncer=true&sslmode=require&sslrootcert=/x.crt",
    );

    expect(url).toBe("postgresql://u:p@host:6543/postgres?pgbouncer=true");
    expect(removidos.sort()).toEqual(["sslmode", "sslrootcert"]);
  });

  it("не трогают пароль и остальную часть строки", () => {
    // Разбор и пересборка адреса целиком умеет незаметно переписать пароль.
    const original =
      "postgresql://postgres.abc:S%40nha%3Aestranha@aws-0.pooler.supabase.com:6543/postgres?sslmode=require";
    const { url } = stripTlsParams(original);

    expect(url).toBe(
      "postgresql://postgres.abc:S%40nha%3Aestranha@aws-0.pooler.supabase.com:6543/postgres",
    );
  });

  it("строка без параметров остаётся как есть", () => {
    const original = "postgresql://u:p@host:5432/postgres";
    expect(stripTlsParams(original)).toEqual({ url: original, removidos: [] });
  });

  it("единственный параметр TLS убирает и сам знак вопроса", () => {
    const { url } = stripTlsParams("postgresql://u:p@host:5432/db?sslmode=require");
    expect(url).toBe("postgresql://u:p@host:5432/db");
  });

  it("имя параметра узнаётся независимо от регистра", () => {
    const { removidos } = stripTlsParams("postgresql://u:p@h:1/d?SSLMode=require");
    expect(removidos).toEqual(["sslmode"]);
  });
});

describe("источник строки подключения", () => {
  it("заполненный DATABASE_URL отменяет сборку из частей", () => {
    // Ровно та ловушка, из-за которой настройки частей перестают
    // применяться целиком и молча.
    const env = {
      DATABASE_URL: "postgresql://u:p@host:5432/db",
      DATABASE_HOST: "outro-host",
      DATABASE_USER: "u",
      DATABASE_PASSWORD: "p",
    } as NodeJS.ProcessEnv;

    expect(databaseUrlSource(env)).toBe("DATABASE_URL");
  });

  it("пустой DATABASE_URL не считается заданным", () => {
    const env = {
      DATABASE_URL: "   ",
      DATABASE_HOST: "host",
      DATABASE_USER: "u",
      DATABASE_PASSWORD: "p",
    } as NodeJS.ProcessEnv;

    expect(databaseUrlSource(env)).toBe("partes");
  });

  it("без частей и без строки источника нет", () => {
    expect(databaseUrlSource({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
