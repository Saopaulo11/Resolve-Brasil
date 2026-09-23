import { loadConfig } from "../config/env";
import { recordSignupConsents, setMarketingConsent } from "../privacy/consent";
import { createSession, type ClientContext } from "../services/session";
import { trackEvent } from "../analytics/events";
import { generateOtpCode, hashOtpCode, safeEquals } from "../utils/crypto";
import { logger, maskPhone } from "../utils/logger";
import { otpProvider } from "./otpProvider";
import {
  attemptsLeft,
  evaluateChallenge,
  expiryFrom,
  secondsUntilResend,
  type ChallengeVerdict,
} from "./otpPolicy";
import { stores } from "./storeRegistry";

/**
 * Вход по телефону и одноразовому коду (§15, §67).
 *
 * Регистрация и вход — один и тот же путь. Это не только проще: раздельные
 * формы отвечали бы на вопрос «зарегистрирован ли этот номер», а такой ответ
 * никому, кроме собирающего базы, не нужен.
 */

/**
 * Секрет для HMAC кода. Код короткий — миллион вариантов перебирается
 * мгновенно, поэтому хеш обязан быть с серверным секретом.
 */
function otpSecret(): string {
  const config = loadConfig();
  if (config.session.secret) return config.session.secret;
  if (config.isProduction) {
    throw new Error("SESSION_SECRET обязателен: без него хеш OTP бесполезен.");
  }
  // В разработке loadConfig секрета не требует; собственного умолчания не
  // изобретаем — берём заведомо непригодное для production значение.
  return "desenvolvimento-sem-session-secret";
}

export type RequestCodeResult =
  | { ok: true; expiresInSeconds: number }
  | { ok: false; reason: "aguarde"; secondsUntilResend: number }
  | { ok: false; reason: "envio_falhou" };

export async function requestCode(
  phone: string,
  ipPrefix: string | null,
): Promise<RequestCodeResult> {
  const config = loadConfig();
  const { otp } = stores();
  const now = new Date();

  const latest = await otp.findLatest(phone);
  const wait = secondsUntilResend(
    latest?.createdAt ?? null,
    config.otp.resendCooldownSeconds,
    now,
  );

  if (wait > 0) {
    return { ok: false, reason: "aguarde", secondsUntilResend: wait };
  }

  // Новый код гасит все предыдущие (§67): иначе старое SMS остаётся рабочим
  // ключом от учётной записи неограниченно долго.
  await otp.invalidateActive(phone, now);

  const code = generateOtpCode(config.otp.length);
  await otp.create({
    phone,
    codeHash: hashOtpCode(code, phone, otpSecret()),
    maxAttempts: config.otp.maxAttempts,
    expiresAt: expiryFrom(now, config.otp.ttlSeconds),
    ipPrefix,
  });

  const delivery = await otpProvider().send(phone, code);
  if (!delivery.delivered) {
    logger().error({ phone: maskPhone(phone) }, "falha ao enviar código");
    return { ok: false, reason: "envio_falhou" };
  }

  void trackEvent("otp_requested");
  return { ok: true, expiresInSeconds: config.otp.ttlSeconds };
}

/**
 * Как далеко назад искать уже погашенный код. Час с запасом покрывает
 * медленную доставку SMS; дальше это уже не задержка, а чужая попытка.
 */
const SUPERSEDED_LOOKBACK_MS = 60 * 60_000;

export type VerifyCodeResult =
  | { ok: true; userId: string; isNewUser: boolean; token: string }
  | { ok: false; reason: "sem_codigo" }
  | { ok: false; reason: Exclude<ChallengeVerdict, "valido"> }
  | { ok: false; reason: "codigo_incorreto"; attemptsLeft: number };

export async function verifyCode(input: {
  phone: string;
  code: string;
  client: ClientContext;
  marketingConsent: boolean;
}): Promise<VerifyCodeResult> {
  const { otp, users } = stores();
  const now = new Date();

  const challenge = await otp.findLatest(input.phone);
  if (!challenge) return { ok: false, reason: "sem_codigo" };

  const verdict = evaluateChallenge(challenge, now);
  if (verdict !== "valido") {
    logger().warn(
      { phone: maskPhone(input.phone), verdict },
      "tentativa de código recusada",
    );
    return { ok: false, reason: verdict };
  }

  const expected = hashOtpCode(input.code, input.phone, otpSecret());

  if (!safeEquals(expected, challenge.codeHash)) {
    // Запоздавшая SMS — не ошибка пользователя.
    //
    // В Бразилии SMS нередко идёт минутами. Человек успевает запросить код
    // повторно, и тут приходит первый. Без этой проверки ему скажут «код
    // неверный» и спишут попытку — хотя он набрал ровно то, что получил.
    // Поэтому сначала смотрим, не был ли этот код нашим недавно.
    const superseded = await otp.findRecentByCodeHash(
      input.phone,
      expected,
      new Date(now.getTime() - SUPERSEDED_LOOKBACK_MS),
    );

    if (superseded) {
      const supersededVerdict = evaluateChallenge(superseded, now);
      if (supersededVerdict !== "valido") {
        // Попытка не списывается: код действительно был выдан нами.
        return { ok: false, reason: supersededVerdict };
      }
    }

    // Попытка засчитывается до ответа: иначе перебор ничего не стоит.
    const attempts = await otp.recordAttempt(challenge.id);
    logger().warn(
      { phone: maskPhone(input.phone), attempts },
      "código incorreto",
    );
    return {
      ok: false,
      reason: "codigo_incorreto",
      attemptsLeft: attemptsLeft({ ...challenge, attempts }),
    };
  }

  // Код гасится сразу после совпадения: повторно он не сработает (§67).
  await otp.consume(challenge.id, now);

  const existing = await users.findByPhone(input.phone);
  const user = existing ?? (await users.create(input.phone));
  const isNewUser = !existing;

  if (existing && !existing.phoneVerified) {
    await users.markPhoneVerified(existing.id);
  }

  if (isNewUser) {
    await recordSignupConsents({
      userId: user.id,
      source: "CADASTRO",
      ipPrefix: input.client.ipPrefix,
    });
  }

  // Маркетинг записывается только когда он выбран или когда пользователь
  // новый: иначе повторный вход без галочки молча отписывал бы человека.
  if (input.marketingConsent || isNewUser) {
    await setMarketingConsent({
      userId: user.id,
      accepted: input.marketingConsent,
      source: "CADASTRO",
      ipPrefix: input.client.ipPrefix,
    });
  }

  const token = await createSession(user.id, input.client);

  void trackEvent("otp_verified", { userId: user.id });
  if (input.marketingConsent) void trackEvent("marketing_opt_in", { userId: user.id });

  return { ok: true, userId: user.id, isNewUser, token };
}
