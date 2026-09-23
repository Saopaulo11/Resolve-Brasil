import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Обёртка вместо promisify: promisify теряет перегрузку с параметрами, а
 * параметры scrypt — это и есть его стойкость. Без них он падает к
 * умолчаниям, и смысл теряется.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * Пароли администраторов (§51).
 *
 * scrypt, а не SHA: обычный хеш подбирается перебором со скоростью
 * миллиардов вариантов в секунду, и украденная таблица админов означала бы
 * вскрытые пароли к вечеру того же дня. scrypt намеренно медленный и
 * требовательный к памяти.
 *
 * Берётся из стандартной библиотеки Node, без внешней зависимости: меньше
 * поверхность для компрометации цепочки поставок в самом чувствительном месте.
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Параметры подбираются так, чтобы одна проверка занимала десятки
 * миллисекунд: человеку при входе незаметно, перебору — дорого.
 */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Формат: scrypt$N$r$p$соль$хеш — параметры хранятся рядом с хешем. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Проверка пароля.
 *
 * Параметры читаются из самого хеша: когда через год их придётся поднять,
 * старые пароли продолжат проверяться, а не перестанут работать разом.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: PARAMS.maxmem,
    });

    // Сравнение за постоянное время: обычное равенство утекает длину
    // совпавшего префикса.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Требования к паролю админа. Слабый пароль здесь стоит дороже всего. */
export type PasswordError = "curta" | "simples";

export const PASSWORD_MESSAGES: Record<PasswordError, string> = {
  curta: "A senha precisa ter pelo menos 12 caracteres.",
  simples: "A senha precisa combinar letras e números.",
};

export function validatePassword(password: string): PasswordError | null {
  if (password.length < 12) return "curta";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "simples";
  return null;
}

export { PARAMS as SCRYPT_PARAMS };
