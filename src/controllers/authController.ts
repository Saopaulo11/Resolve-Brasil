import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { loadConfig } from "../config/env";
import { MARKETING_CHECKBOX_LABEL } from "../privacy/consent";
import { requestCode, verifyCode } from "../users/authService";
import { revokeSession } from "../services/session";
import { VERDICT_MESSAGES, CODIGO_INCORRETO } from "../users/otpPolicy";
import {
  formatBrazilianPhone,
  parseBrazilianPhone,
  PHONE_ERROR_MESSAGES,
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

/** Адрес возврата после входа. Только внутренние пути — иначе open redirect. */
function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/minha-conta";
  if (!value.startsWith("/") || value.startsWith("//")) return "/minha-conta";
  return value;
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

  if (!parsed.success) return showError(PHONE_ERROR_MESSAGES.formato);

  const phone = parseBrazilianPhone(parsed.data.phone);
  if (!phone.ok) return showError(PHONE_ERROR_MESSAGES[phone.reason]);

  const result = await requestCode(phone.e164, ipPrefix(req.ip) ?? null);

  if (!result.ok && result.reason === "aguarde") {
    return showError(
      `Aguarde ${result.secondsUntilResend} segundos para pedir um novo código.`,
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

export function codigoForm(req: Request, res: Response): void {
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
    values: {},
    errors: {},
  });
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
