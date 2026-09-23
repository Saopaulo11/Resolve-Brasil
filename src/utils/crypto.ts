import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/**
 * Криптографические примитивы сессий и OTP (§66, §67).
 *
 * Общий принцип: в базе лежит не секрет, а его хеш. Дамп базы не должен
 * давать ни входа в чужую сессию, ни подтверждения чужого номера.
 */

/** Токен сессии: 32 случайных байта. В куку идёт он, в базу — его хеш. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Хеш токена сессии. SHA-256 без соли здесь уместен: токен и так случайный
 * на 256 бит, перебирать нечего, а быстрый хеш нужен на каждом запросе.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Числовой OTP заданной длины, равномерно случайный. */
export function generateOtpCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String(randomInt(10));
  return out;
}

/**
 * Хеш OTP. Код короткий (шесть цифр — миллион вариантов), поэтому берём
 * HMAC с серверным секретом: без секрета радужная таблица по миллиону
 * значений строится мгновенно. Номер телефона входит в сообщение, чтобы
 * один и тот же код для разных номеров давал разные хеши.
 */
export function hashOtpCode(code: string, phone: string, secret: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

/** Сравнение за постоянное время: обычное === утекает длину общего префикса. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Усечённый IP для журналов. Полный адрес — персональные данные, а для
 * защиты от перебора хватает сети: /24 для IPv4, /48 для IPv6.
 */
export function ipPrefix(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::";
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
