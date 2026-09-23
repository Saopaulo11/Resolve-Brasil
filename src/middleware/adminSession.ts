import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AdminUserRecord } from "../admin/adminStore";
import { resolveAdminSession } from "../admin/adminAuth";
import { can, type Permission } from "../admin/rbac";
import { loadConfig } from "../config/env";
import { ipPrefix } from "../utils/crypto";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminUserRecord;
  }
}

export const ADMIN_COOKIE = "rb_admin";

/**
 * Права, обращение по которым записывается в журнал (§51).
 *
 * Не каждый просмотр страницы: сводка из обезличенных чисел журнала не
 * требует, а поток записей о ней утопил бы то, ради чего журнал заведён.
 * Записывается доступ к данным, за которыми стоят живые люди.
 */
const SENSITIVE: ReadonlySet<Permission> = new Set([
  "cases.list",
  "cases.detail",
  "users.list",
  "documents.list",
  "documents.read",
  "feedback.view",
  "notifications.view",
  "admins.manage",
]);

export function attachAdmin(): RequestHandler {
  const config = loadConfig();

  return async function adminSessionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    res.locals.admin = null;

    const token = req.signedCookies?.[ADMIN_COOKIE] as string | undefined;
    if (!token) return next();

    try {
      const admin = await resolveAdminSession(token);
      if (admin) {
        req.admin = admin;
        res.locals.admin = { email: admin.email, role: admin.role };
      } else {
        res.clearCookie(ADMIN_COOKIE, { path: "/admin" });
      }
    } catch (error) {
      logger().error({ err: error }, "falha ao resolver sessão de admin");
    }

    void config;
    return next();
  };
}

/**
 * Доступ к разделу админки.
 *
 * Отсутствие права и отсутствие входа различаются только редиректом: в
 * обоих случаях наружу не уходит подсказка, существует ли раздел.
 */
export function requirePermission(permission: Permission): RequestHandler {
  return async function permissionGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (!req.admin) {
      res.redirect(303, "/admin/entrar");
      return;
    }

    if (!can(req.admin.role, permission)) {
      // Попытка выйти за пределы своей роли — само по себе событие,
      // которое должно быть видно в журнале.
      await stores().audit.record({
        adminUserId: req.admin.id,
        action: "admin.access.denied",
        entityType: "Permission",
        entityId: permission,
        metadata: { role: req.admin.role, path: req.path },
        ipPrefix: ipPrefix(req.ip) ?? null,
      });

      logger().warn(
        { adminUserId: req.admin.id, role: req.admin.role, permission },
        "acesso negado na administração",
      );

      res.status(403);
      return next(new Error("ADMIN_SEM_PERMISSAO"));
    }

    if (SENSITIVE.has(permission)) {
      await stores().audit.record({
        adminUserId: req.admin.id,
        action: "admin.access",
        entityType: "Permission",
        entityId: permission,
        metadata: { path: req.path },
        ipPrefix: ipPrefix(req.ip) ?? null,
      });
    }

    return next();
  };
}

export { SENSITIVE as SENSITIVE_PERMISSIONS };
