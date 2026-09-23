import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { login, logout } from "../admin/adminAuth";
import { permissionsFor, ROLE_LABELS } from "../admin/rbac";
import { internalReport } from "../analytics/aggregation";
import { findCategoryByValue } from "../cases/categories";
import { statusDefinition } from "../cases/status";
import { loadConfig } from "../config/env";
import { ADMIN_COOKIE } from "../middleware/adminSession";
import { ipPrefix } from "../utils/crypto";
import { renderPage } from "../utils/render";
import { stores } from "../users/storeRegistry";

/**
 * Администрирование (§50, §51).
 *
 * Страницы намеренно показывают минимум: номер дела, категорию, статус,
 * дату. Ни текста обращения, ни телефона, ни документов — сотруднику они
 * для работы не нужны, а показанные однажды они показаны всегда.
 */
const LIST_LIMIT = 100;

function adminPage(
  req: Request,
  res: Response,
  view: string,
  locals: Record<string, unknown> & { title: string },
  next?: NextFunction,
): void {
  renderPage(
    req,
    res,
    view,
    {
      layout: "admin" as const,
      description: "Área administrativa do Resolve Brasil.",
      adminEmail: req.admin?.email ?? null,
      adminRole: req.admin ? ROLE_LABELS[req.admin.role] : null,
      adminPermissions: req.admin ? permissionsFor(req.admin.role) : [],
      ...locals,
    },
    next,
  );
}

// --- Вход -------------------------------------------------------------------

export function entrarForm(req: Request, res: Response): void {
  if (req.admin) {
    res.redirect(303, "/admin");
    return;
  }

  adminPage(req, res, "admin/entrar", {
    title: "Entrar — Administração",
    values: {},
    errors: {},
  });
}

const loginSchema = z.object({
  email: z.string().trim().max(200),
  senha: z.string().max(200),
});

export async function entrar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = loginSchema.safeParse(req.body ?? {});

  const fail = (message: string) => {
    res.status(401);
    adminPage(
      req,
      res,
      "admin/entrar",
      {
        title: "Entrar — Administração",
        values: { email: parsed.success ? parsed.data.email : "" },
        errors: { form: message },
      },
      next,
    );
  };

  // Формулировка одна на все случаи: разные сообщения отвечали бы на
  // вопрос, заведена ли такая учётная запись.
  if (!parsed.success) return fail("E-mail ou senha inválidos.");

  const result = await login(parsed.data.email, parsed.data.senha, {
    ipPrefix: ipPrefix(req.ip) ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (!result.ok) {
    if (result.reason === "bloqueado") {
      return fail("Muitas tentativas. Aguarde antes de tentar novamente.");
    }
    return fail("E-mail ou senha inválidos.");
  }

  const config = loadConfig();
  res.cookie(ADMIN_COOKIE, result.token, {
    httpOnly: true,
    signed: true,
    sameSite: "strict",
    secure: config.isProduction,
    // Кука ограничена разделом админки: на публичных страницах она не нужна
    // и не должна там оказаться.
    path: "/admin",
    maxAge: config.admin.sessionMaxAgeHours * 60 * 60_000,
  });

  res.redirect(303, "/admin");
}

export async function sair(req: Request, res: Response): Promise<void> {
  const token = req.signedCookies?.[ADMIN_COOKIE];
  if (typeof token === "string" && token.length > 0) await logout(token);

  res.clearCookie(ADMIN_COOKIE, { path: "/admin" });
  res.redirect(303, "/admin/entrar");
}

// --- Разделы ----------------------------------------------------------------

export async function painel(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const report = await internalReport();

  adminPage(
    req,
    res,
    "admin/painel",
    {
      title: "Painel — Administração",
      resumo: report.summary,
      minGroupSize: report.minGroupSize,
    },
    next,
  );
}

export async function casos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const list = await stores().cases.listRecent(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/casos",
    {
      title: "Casos — Administração",
      limite: LIST_LIMIT,
      casos: list.map((item) => {
        const status = statusDefinition(item.status);
        return {
          publicId: item.publicId,
          categoria:
            (item.category && findCategoryByValue(item.category)?.label) ??
            "Não classificado",
          empresa: item.companyName ?? "—",
          status: status.label,
          statusTone: status.tone,
          criadoEm: item.createdAt.toLocaleDateString("pt-BR"),
        };
      }),
    },
    next,
  );
}

export async function analytics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const report = await internalReport();

  adminPage(
    req,
    res,
    "admin/analytics",
    {
      title: "Analytics — Administração",
      relatorio: report,
      grupos: [
        { titulo: "Por categoria", dados: report.byCategory },
        { titulo: "Por setor", dados: report.byIndustry },
        { titulo: "Por forma de pagamento", dados: report.byPaymentMethod },
        { titulo: "Por faixa de valor", dados: report.byAmountBucket },
        { titulo: "Por mês", dados: report.byMonth },
        { titulo: "Por estado", dados: report.byState },
      ],
    },
    next,
  );
}

export async function auditoria(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const entries = await stores().audit.list(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/auditoria",
    {
      title: "Registros de acesso — Administração",
      limite: LIST_LIMIT,
      registros: entries.map((entry) => ({
        acao: entry.action,
        tipo: entry.entityType,
        entidade: entry.entityId ?? "—",
        quando: entry.createdAt.toLocaleString("pt-BR"),
        rede: entry.ipPrefix ?? "—",
      })),
    },
    next,
  );
}
