/**
 * Правила одноразовых кодов (§67) — без обращений к базе.
 *
 * Логика вынесена отдельно намеренно: именно здесь живут свойства, от
 * которых зависит безопасность входа (срок жизни, лимит попыток,
 * одноразовость, гашение предыдущего кода). Их нужно уметь проверять
 * тестами целиком, не поднимая PostgreSQL.
 */

export type OtpChallengeState = {
  attempts: number;
  maxAttempts: number;
  consumedAt: Date | null;
  invalidatedAt: Date | null;
  expiresAt: Date;
};

export type ChallengeVerdict =
  | "valido"
  | "expirado"
  | "ja_usado"
  | "substituido"
  | "tentativas_esgotadas";

/**
 * Пригоден ли код к проверке.
 *
 * Порядок проверок важен: сначала то, что делает код мёртвым навсегда
 * (использован, заменён), потом срок, и только потом счётчик попыток.
 * Иначе истёкший код с исчерпанными попытками отчитается как «попытки
 * кончились», и человек будет ждать снятия лимита вместо запроса нового кода.
 */
export function evaluateChallenge(
  challenge: OtpChallengeState,
  now: Date = new Date(),
): ChallengeVerdict {
  if (challenge.consumedAt) return "ja_usado";
  if (challenge.invalidatedAt) return "substituido";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "expirado";
  if (challenge.attempts >= challenge.maxAttempts) return "tentativas_esgotadas";
  return "valido";
}

/** Момент истечения кода. */
export function expiryFrom(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000);
}

/**
 * Сколько секунд осталось до возможности запросить новый код.
 *
 * Пауза между отправками нужна не только против спама: без неё каждый
 * запрос гасит предыдущий код, и человек, у которого SMS идёт медленно,
 * попадает в цикл, где ни один пришедший код уже не действует.
 */
export function secondsUntilResend(
  lastRequestedAt: Date | null,
  cooldownSeconds: number,
  now: Date = new Date(),
): number {
  if (!lastRequestedAt) return 0;
  const elapsed = (now.getTime() - lastRequestedAt.getTime()) / 1000;
  const remaining = Math.ceil(cooldownSeconds - elapsed);
  return remaining > 0 ? remaining : 0;
}

export function canResend(
  lastRequestedAt: Date | null,
  cooldownSeconds: number,
  now: Date = new Date(),
): boolean {
  return secondsUntilResend(lastRequestedAt, cooldownSeconds, now) === 0;
}

/** Сколько попыток осталось — показывается пользователю, чтобы не гадал. */
export function attemptsLeft(challenge: OtpChallengeState): number {
  const left = challenge.maxAttempts - challenge.attempts;
  return left > 0 ? left : 0;
}

/**
 * Текст для пользователя, pt-BR.
 *
 * Формулировки намеренно не различают «код неверный» и «такого номера нет»:
 * иначе форма входа превращается в проверку, зарегистрирован ли телефон.
 */
export const VERDICT_MESSAGES: Record<Exclude<ChallengeVerdict, "valido">, string> = {
  expirado: "O código expirou. Peça um novo código.",
  ja_usado: "Esse código já foi usado. Peça um novo código.",
  substituido: "Esse código não vale mais — um código mais novo foi enviado.",
  tentativas_esgotadas:
    "Muitas tentativas com esse código. Peça um novo código.",
};

export const CODIGO_INCORRETO = "Código incorreto. Confira e tente novamente.";
