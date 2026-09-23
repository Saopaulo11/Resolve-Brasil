import type { NextFunction, Request, Response } from "express";

import { getCaseForUser } from "../cases/caseService";
import {
  cancelReminder,
  createReminder,
  REMINDER_ERROR_MESSAGES,
} from "../notifications/reminderService";
import { isValidPublicCaseId } from "../utils/ids";

/**
 * Напоминания по делу (§37).
 */
const DEFAULT_TITLE = "Verificar a resposta da empresa";
const MAX_TITLE_LENGTH = 120;

async function resolveCase(req: Request, userId: string) {
  const raw = req.params.publicId;
  const publicId = typeof raw === "string" ? raw : "";
  if (!isValidPublicCaseId(publicId)) return null;
  return getCaseForUser(publicId, userId);
}

export async function criar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawTitle = typeof body.titulo === "string" ? body.titulo.trim() : "";
  const title = (rawTitle.length > 0 ? rawTitle : DEFAULT_TITLE).slice(
    0,
    MAX_TITLE_LENGTH,
  );

  const result = await createReminder({
    userId,
    caseId: found.case.id,
    publicId: found.case.publicId,
    title,
    preset: typeof body.prazo === "string" && body.prazo !== "custom" ? body.prazo : null,
    customDate: typeof body.data === "string" ? body.data : null,
  });

  const target = `/caso/${found.case.publicId}`;
  if (result.ok) {
    res.redirect(303, `${target}#lembretes`);
    return;
  }

  res.redirect(
    303,
    `${target}?aviso=${encodeURIComponent(REMINDER_ERROR_MESSAGES[result.reason])}#lembretes`,
  );
}

export async function cancelar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const reminderId =
    typeof req.params.reminderId === "string" ? req.params.reminderId : "";
  if (reminderId.length === 0) return next();

  // Чужое напоминание отменить нельзя: проверка идёт по делу, а не по
  // идентификатору из адреса.
  const ok = await cancelReminder({ reminderId, caseId: found.case.id });
  if (!ok) return next();

  res.redirect(303, `/caso/${found.case.publicId}#lembretes`);
}

export { DEFAULT_TITLE };
