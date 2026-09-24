import { describe, expect, it } from "vitest";

import {
  composeDatabaseUrl,
  partesFaltando,
  resolveDatabaseUrl,
} from "../../src/config/databaseUrl";

/**
 * Строка подключения, собранная из частей.
 *
 * Существует ради одной ошибки: подставить прямое подключение вместо пула.
 * У прямого хоста Supabase нет записи IPv4, исходящего IPv6 у бессерверных
 * функций тоже нет — соединение не начинается, в логах базы пусто, и отказ
 * неотличим от неверного пароля. Когда хост задан отдельной переменной и
 * меняется раз в жизни, испортить его при ротации пароля нечем.
 */
const PARTES = {
  host: "aws-0-sa-east-1.pooler.supabase.com",
  port: "6543",
  user: "postgres.projeto",
  password: "SenhaSimples123",
  name: "postgres",
  params: "pgbouncer=true&sslmode=require",
};

describe("сборка строки", () => {
  it("складывает части в рабочую строку", () => {
    const url = composeDatabaseUrl(PARTES);

    expect(url).toBe(
      "postgresql://postgres.projeto:SenhaSimples123@" +
        "aws-0-sa-east-1.pooler.supabase.com:6543/postgres" +
        "?pgbouncer=true&sslmode=require",
    );
    // Строка должна разбираться как URL — иначе драйвер увидит не то.
    expect(new URL(url as string).hostname).toBe("aws-0-sa-east-1.pooler.supabase.com");
  });

  it("кодирует спецсимволы в пароле", () => {
    // `@` в пароле делает хостом кусок пароля: строка остаётся синтаксически
    // верной и ведёт совсем не туда. Это вторая по частоте ошибка после
    // неправильного хоста.
    const url = composeDatabaseUrl({ ...PARTES, password: "a@b:c/d#e" }) as string;

    expect(url).toContain("a%40b%3Ac%2Fd%23e");
    expect(new URL(url).hostname).toBe("aws-0-sa-east-1.pooler.supabase.com");
    expect(new URL(url).password).toBe("a%40b%3Ac%2Fd%23e");
  });

  it("принимает параметры и с ведущим вопросительным знаком", () => {
    // Из консоли Supabase их копируют по-разному, а разницы нет.
    expect(composeDatabaseUrl({ ...PARTES, params: "?sslmode=require" })).toBe(
      composeDatabaseUrl({ ...PARTES, params: "sslmode=require" }),
    );
  });

  it("подставляет порт и базу по умолчанию", () => {
    const url = composeDatabaseUrl({
      host: "db.exemplo.com",
      user: "postgres",
      password: "senha",
    }) as string;

    expect(url).toBe("postgresql://postgres:senha@db.exemplo.com:5432/postgres");
  });

  it("не собирает строку наполовину", () => {
    // Строка без пароля синтаксически верна и подключится не туда. Честный
    // отказ лучше: он называет, чего не хватает.
    expect(composeDatabaseUrl({ host: "h", user: "u" })).toBeNull();
    expect(partesFaltando({ host: "h", user: "u" })).toEqual(["DATABASE_PASSWORD"]);
    expect(partesFaltando({})).toEqual([
      "DATABASE_HOST",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
    ]);
  });
});

describe("что выбирается из окружения", () => {
  it("заданная целиком строка важнее частей", () => {
    // DATABASE_URL задают осознанно; спорить с ним нечем.
    const url = resolveDatabaseUrl({
      DATABASE_URL: "postgresql://a:b@direto:5432/x",
      DATABASE_HOST: PARTES.host,
      DATABASE_USER: PARTES.user,
      DATABASE_PASSWORD: PARTES.password,
    } as NodeJS.ProcessEnv);

    expect(url).toBe("postgresql://a:b@direto:5432/x");
  });

  it("части работают, когда строки целиком нет", () => {
    const url = resolveDatabaseUrl({
      DATABASE_HOST: PARTES.host,
      DATABASE_PORT: PARTES.port,
      DATABASE_USER: PARTES.user,
      DATABASE_PASSWORD: PARTES.password,
    } as NodeJS.ProcessEnv);

    expect(url).toContain("pooler.supabase.com:6543");
  });

  it("пустая строка целиком не считается заданной", () => {
    // Переменная, стёртая до пустоты, — это «не задано», а не «подключайся
    // в никуда».
    expect(
      resolveDatabaseUrl({ DATABASE_URL: "   " } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});
