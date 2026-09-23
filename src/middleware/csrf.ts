import type { NextFunction, Request, RequestHandler, Response } from "express";

import { loadConfig } from "../config/env";
import { randomToken, safeEquals } from "../utils/crypto";

/**
 * CSRF по схеме double-submit (§66).
 *
 * В куке лежит случайное значение, в форме — скрытое поле с ним же. Стороннему
 * сайту кука недоступна для чтения, поэтому подделать пару он не может.
 * SameSite сам по себе не считается достаточной защитой: он не работает
 * одинаково во всех клиентах и отключается пользователем.
 */
const COOKIE_NAME = "rb_csrf";
const FIELD_NAME = "_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

declare module "express-serve-static-core" {
  interface Request {
    csrfToken?: string;
  }
}

export function csrfProtection(): RequestHandler {
  const config = loadConfig();

  return function csrf(req: Request, res: Response, next: NextFunction) {
    let token = req.cookies?.[COOKIE_NAME] as string | undefined;

    if (!token) {
      token = randomToken(32);
      res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        path: "/",
      });
    }

    req.csrfToken = token;
    res.locals.csrfToken = token;

    if (SAFE_METHODS.has(req.method)) return next();

    const submitted =
      (req.body as Record<string, unknown> | undefined)?.[FIELD_NAME] ??
      req.get("x-csrf-token");

    if (typeof submitted !== "string" || !safeEquals(submitted, token)) {
      res.status(403);
      return next(new Error("CSRF_TOKEN_INVALIDO"));
    }

    return next();
  };
}

export { COOKIE_NAME as CSRF_COOKIE_NAME, FIELD_NAME as CSRF_FIELD_NAME };
