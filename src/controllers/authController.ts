import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { attachCaseToUser } from "../cases/caseService";
import { PENDING_CASE_COOKIE } from "./casesController";
import { loadConfig } from "../config/env";
import { MARKETING_CHECKBOX_LABEL } from "../privacy/consent";
import { requestCode, verifyCode } from "../users/authService";
import { revokeAllSessions, revokeSession } from "../services/session";
import {
  VERDICT_MESSAGES,
  CODIGO_INCORRETO,
  secondsUntilResend,
} from "../users/otpPolicy";
import { stores } from "../users/storeRegistry";
import {
  formatBrazilianPhone,
  parseBrazilianPhone,
  PHONE_ERROR_MESSAGE,
} from "../utils/phone";
import { ipPrefix } from "../utils/crypto";
import { renderPage } from "../utils/render";

/**
 * Вход по телефону и OTP (§15).
 *
 * Номер между шагами переносится подписанной кукой, а не параметром адреса:
 * из URL он попал бы в историю браузера, в журналы прокси и в заголовок
 * Referer при переходе на любую внешнюю ссылку.
 */
const LOGIN_COOKIE = "rb_login";

function loginCookieOptions(maxAgeMs: number) {
  const config = loadConfig();
  return {
    httpOnly: true,
    signed: true,
    sameSite: "lax" as const,
    secure: config.isProduction,
    path: "/",
    maxAge: maxAgeMs,
  };
}

function client(req: Request) {
  return {
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
    ipPrefix: ipPrefix(req.ip) ?? null,
  };
}

/** Куда возвращать, если адрес возврата не годится. */
const DEFAULT_NEXT = "/minha-conta";

/**
 * Фиктивная база для разбора. Наружу не выходит и никуда не ведёт: нужна
 * только чтобы относительный адрес стало возможно разобрать как URL.
 */
const NEXT_BASE = "http://next.invalid";

/**
 * Адрес возврата после входа. Только внутренние пути — иначе open redirect.
 *
 * Проверки «начинается со слеша и не с двух» недостаточно: «/\evil.com» её
 * проходит, а браузер читает обратный слеш как второй слеш и уходит на
 * чужой сайт. Поэтому адрес разбирается целиком, и наружу отдаётся только
 * путь — всё, что меняет источник, отбрасывается вместе с ним.
 */
function safeNext(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return DEFAULT_NEXT;

  let url: URL;
  try {
    url = new URL(value, NEXT_BASE);
  } catch {
    return DEFAULT_NEXT;
  }

  if (url.origin !== NEXT_BASE) return DEFAULT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}

// --- Шаг 1: телефон ---------------------------------------------------------

export function telefoneForm(req: Request, res: Response): void {
  renderPage(req, res, "entrar", {
    title: "Entrar — Resolve Brasil",
    description: "Entre com seu telefone para acompanhar seus casos.",
    nextUrl: safeNext(req.query.next),
    values: {},
    errors: {},
  });
}

const phoneSchema = z.object({ phone: z.string().max(40) });

export async function enviarCodigo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const nextUrl = safeNext(body.next);
  const parsed = phoneSchema.safeParse(body);
  const raw = typeof body.phone === "string" ? body.phone : "";

  const showError = (message: string) => {
    res.status(400);
    renderPage(
      req,
      res,
      "entrar",
      {
        title: "Entrar — Resolve Brasil",
        description: "Entre com seu telefone para acompanhar seus casos.",
        nextUrl,
        values: { phone: raw },
        errors: { phone: message },
      },
      next,
    );
  };

  if (!parsed.success) return showError(PHONE_ERROR_MESSAGE);

  const phone = parseBrazilianPhone(parsed.data.phone);
  if (!phone.ok) return showError(PHONE_ERROR_MESSAGE);

  // Код входа уходит в WhatsApp, а WhatsApp живёт на мобильном номере: на
  // городской он не придёт никогда. Раньше такой номер принимался, человек
  // ждал сообщение, и ждать было нечего.
  if (!phone.isMobile) return showError(PHONE_ERROR_MESSAGE);

  const result = await requestCode(phone.e164, ipPrefix(req.ip) ?? null);

  if (!result.ok && result.reason === "aguarde") {
    // Начатый вход продолжается на шаге кода — туда и возвращаем: там идёт
    // отсчёт и видно, сколько ждать. Выбрасывать человека на первый шаг
    // значило бы потерять начатое.
    //
    // Но только если вход действительно начат этим же номером. Иначе кука
    // истекла или её не было вовсе, шаг кода такого человека всё равно
    // отправит назад — и он получит пустую страницу входа без объяснения.
    // В этом случае причина называется прямо здесь.
    if (pendingPhone(req) === phone.e164) {
      res.redirect(303, `/entrar/codigo?next=${encodeURIComponent(nextUrl)}`);
      return;
    }

    return showError(
      `Você poderá solicitar um novo código em ${result.secondsUntilResend} segundos.`,
    );
  }

  if (!result.ok) {
    return showError("Não foi possível enviar o código agora. Tente novamente.");
  }

  const config = loadConfig();
  // Кука живёт чуть дольше кода: иначе истёкшая кука уводит на первый шаг
  // раньше, чем человек успевает увидеть сообщение про истёкший код.
  res.cookie(
    LOGIN_COOKIE,
    phone.e164,
    loginCookieOptions((config.otp.ttlSeconds + 300) * 1000),
  );

  res.redirect(303, `/entrar/codigo?next=${encodeURIComponent(nextUrl)}`);
}

// --- Шаг 2: код -------------------------------------------------------------

function pendingPhone(req: Request): string | null {
  const value = req.signedCookies?.[LOGIN_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function codigoForm(req: Request, res: Response): Promise<void> {
  const phone = pendingPhone(req);
  if (!phone) {
    res.redirect(303, "/entrar");
    return;
  }

  renderPage(req, res, "entrar-codigo", {
    title: "Confirmar código — Resolve Brasil",
    description: "Confirme o código enviado para o seu telefone.",
    phoneMasked: formatBrazilianPhone(phone),
    nextUrl: safeNext(req.query.next),
    marketingLabel: MARKETING_CHECKBOX_LABEL,
    // Сколько ещё нельзя просить новый код. Считает сервер: на клиенте это
    // была бы просьба, а не правило, и часы у всех свои.
    aguardeSegundos: await segundosAteReenvio(phone),
    values: {},
    errors: {},
  });
}

/** Остаток паузы до повторной отправки — 0, если просить можно сейчас. */
async function segundosAteReenvio(phone: string): Promise<number> {
  const config = loadConfig();
  const latest = await stores().otp.findLatest(phone);
  return secondsUntilResend(
    latest?.createdAt ?? null,
    config.otp.resendCooldownSeconds,
  );
}

/**
 * DEVELOPMENT ONLY (§79) — снять паузу между отправками кода.
 *
 * Нужен, чтобы проходить вход подряд при проверке: пауза в минуту делает
 * ручной прогон и автотест против живого стенда невыносимыми.
 *
 * В production маршрут не существует — он не регистрируется вовсе
 * (см. routes/index.ts), а не закрывается проверкой внутри. Проверку внутри
 * можно однажды обойти опечаткой в условии; несуществующий маршрут обойти
 * нечем. Здесь стоит вторая проверка на тот случай, если обработчик всё же
 * подключат где-то ещё.
 *
 * Код при этом не раскрывается: гасятся действующие вызовы, и следующий
 * запрос выдаёт новый код обычным путём.
 */
export async function reiniciarEsperaDev(req: Request, res: Response): Promise<void> {
  if (loadConfig().isProduction) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  // Именно удаление, а не гашение: пауза считается от времени создания
  // последнего кода, и погашенный код её не отпускает.
  const phone = pendingPhone(req);
  if (phone) await stores().otp.clearForPhone(phone);

  res.redirect(303, "/entrar/codigo");
}

const codeSchema = z.object({
  code: z.string().trim().regex(/^\d{4,8}$/, CODIGO_INCORRETO),
});

export async function confirmarCodigo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const phone = pendingPhone(req);
  if (!phone) {
    res.redirect(303, "/entrar");
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const nextUrl = safeNext(body.next);
  const marketingConsent = body.marketing === "on" || body.marketing === "true";

  // Считаем один раз на запрос: неверный код не отменяет паузу, и отсчёт на
  // странице должен продолжиться с того же места, а не начаться заново.
  const aguardeSegundos = await segundosAteReenvio(phone);

  const showError = (message: string) => {
    res.status(400);
    renderPage(
      req,
      res,
      "entrar-codigo",
      {
        title: "Confirmar código — Resolve Brasil",
        description: "Confirme o código enviado para o seu telefone.",
        phoneMasked: formatBrazilianPhone(phone),
        nextUrl,
        marketingLabel: MARKETING_CHECKBOX_LABEL,
        aguardeSegundos,
        values: { marketing: marketingConsent },
        errors: { code: message },
      },
      next,
    );
  };

  const parsed = codeSchema.safeParse(body);
  if (!parsed.success) return showError(CODIGO_INCORRETO);

  const result = await verifyCode({
    phone,
    code: parsed.data.code,
    client: client(req),
    marketingConsent,
  });

  if (!result.ok) {
    if (result.reason === "sem_codigo") {
      res.clearCookie(LOGIN_COOKIE, { path: "/" });
      res.redirect(303, "/entrar");
      return;
    }
    if (result.reason === "codigo_incorreto") {
      return showError(
        result.attemptsLeft > 0
          ? `${CODIGO_INCORRETO} Tentativas restantes: ${result.attemptsLeft}.`
          : CODIGO_INCORRETO,
      );
    }
    return showError(VERDICT_MESSAGES[result.reason]);
  }

  const config = loadConfig();
  res.clearCookie(LOGIN_COOKIE, { path: "/" });
  res.cookie(config.session.cookieName, result.token, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: config.session.maxAgeMs,
  });

  // Дело, начатое до входа, становится делом этого пользователя (§15).
  const pending = req.signedCookies?.[PENDING_CASE_COOKIE];
  if (typeof pending === "string" && pending.length > 0) {
    res.clearCookie(PENDING_CASE_COOKIE, { path: "/" });
    const attached = await attachCaseToUser(pending, result.userId);
    if (attached) {
      res.redirect(303, `/caso/${attached.publicId}`);
      return;
    }
  }

  res.redirect(303, nextUrl);
}

// --- Выход ------------------------------------------------------------------

export async function sair(req: Request, res: Response): Promise<void> {
  const config = loadConfig();
  const token = req.signedCookies?.[config.session.cookieName];

  if (typeof token === "string" && token.length > 0) {
    await revokeSession(token);
  }

  res.clearCookie(config.session.cookieName, { path: "/" });
  res.redirect(303, "/");
}

/**
 * Выход со всех устройств (§66).
 *
 * Нужен на случай потерянного или чужого телефона: вход у нас по номеру и
 * коду, паролю меняться нечему, и без этого человеку нечем прекратить
 * чужую сессию — она живёт тридцать дней.
 */
export async function sairDeTodos(req: Request, res: Response): Promise<void> {
  const config = loadConfig();
  const userId = req.session?.userId;

  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  // Текущая сессия отзывается вместе с остальными: «все» значит все, иначе
  // человек решит, что вышел, а на этом устройстве останется вошедшим.
  await revokeAllSessions(userId);

  res.clearCookie(config.session.cookieName, { path: "/" });
  res.redirect(303, "/entrar?aviso=" + encodeURIComponent("Você saiu de todos os dispositivos."));
}
