import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "../../src/admin/password";

const PASSWORD = "senha-forte-para-teste-2026";

describe("хеширование паролей админа (§51)", () => {
  it("проверяет верный пароль", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
  });

  it("отвергает неверный", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword("outra-senha-qualquer-2026", stored)).toBe(false);
  });

  it("не хранит пароль в открытом виде", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).not.toContain(PASSWORD);
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("два одинаковых пароля дают разные хеши", async () => {
    // Своя соль на каждый пароль: иначе одинаковые пароли видны в дампе,
    // и радужная таблица вскрывает их разом.
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("хранит параметры рядом с хешем", async () => {
    // Когда параметры придётся поднять, старые пароли должны продолжить
    // проверяться, а не перестать работать разом.
    const stored = await hashPassword(PASSWORD);
    const [algo, N, r, p] = stored.split("$");
    expect(algo).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("не падает на испорченном хеше", async () => {
    for (const broken of ["", "lixo", "scrypt$1$2", "md5$1$1$1$a$b", "scrypt$x$y$z$a$b"]) {
      expect(await verifyPassword(PASSWORD, broken), broken).toBe(false);
    }
  });
});

describe("требования к паролю", () => {
  it("отвергает короткий", () => {
    expect(validatePassword("curta1")).toBe("curta");
  });

  it("отвергает без цифр и без букв", () => {
    expect(validatePassword("senhasemnumeros")).toBe("simples");
    expect(validatePassword("123456789012345")).toBe("simples");
  });

  it("принимает достаточный", () => {
    expect(validatePassword(PASSWORD)).toBeNull();
  });
});
