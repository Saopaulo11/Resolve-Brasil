import type { NextFunction, Request, RequestHandler, Response } from "express";

import { loadConfig } from "../config/env";
import { logger } from "../utils/logger";
import { resolveSession, touchSession, type SessionInfo } from "../services/session";

declare module "express-serve-static-core" {
  interface Request {
    session?: SessionInfo;
  }
}

/**
 * Опознаёт пользователя по куке сессии. Анонимный доступ — нормальное
 * состояние: лендинг и публичные страницы обязаны работать без входа.
 */
export function attachSession(): RequestHandler {
  const config = loadConfig();

  return async function sessionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    res.locals.user = null;

    const token = req.signedCookies?.[config.session.cookieName] as string | undefined;
    if (!token) return next();

    try {
      const session = await resolveSession(token);
      if (session) {
        req.session = session;
        res.locals.userId = session.userId;
        void touchSession(session.id).catch(() => undefined);
      } else {
        // Кука есть, сессии нет: протухла или отозвана — убираем.
        res.clearCookie(config.session.cookieName, { path: "/" });
      }
    } catch (error) {
      // Недоступная база не должна ронять публичные страницы.
      logger().error({ err: error }, "falha ao resolver sessão");
    }

    return next();
  };
}

/** Страницы личного кабинета: без входа — на форму входа. */
export function requireAuth(): RequestHandler {
  return function authGuard(req: Request, res: Response, next: NextFunction) {
    if (req.session) return next();
    const next_ = encodeURIComponent(req.originalUrl);
    return res.redirect(`/entrar?next=${next_}`);
  };
}
