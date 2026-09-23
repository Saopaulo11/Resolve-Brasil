import type { NextFunction, Request, Response } from "express";

import {
  closeCase,
  escalateCase,
  ESCALATION_ORDER,
  getCaseForUser,
  reopenCase,
  setPixSituation,
  type CaseOutcome,
  type EscalationStep,
} from "../cases/caseService";
import { isPixSituation, pixSituationDefinition } from "../cases/pix";
import { ESCALATION_LABELS } from "../cases/status";
import { isValidPublicCaseId } from "../utils/ids";

/**
 * Завершение дела и переход на другой канал (§19, §36).
 *
 * Оба действия — запись того, что сделал сам человек. Мы не знаем, вернулись
 * ли деньги, и не подаём жалобу за него (§3): здесь только его слова.
 */
async function resolveCase(req: Request, userId: string) {
  const raw = req.params.publicId;
  const publicId = typeof raw === "string" ? raw : "";
  if (!isValidPublicCaseId(publicId)) return null;
  return getCaseForUser(publicId, userId);
}

function requireUser(req: Request, res: Response): string | null {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return null;
  }
  return userId;
}

const OUTCOMES: readonly CaseOutcome[] = ["resolvido", "encerrado"];

export async function encerrar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const outcome = OUTCOMES.find((item) => item === body.desfecho);
  if (!outcome) return next();

  const updated = await closeCase({ caseRecord: found.case, outcome });

  // Уже закрытое дело закрыть повторно нельзя: молчаливый повтор сдвинул бы
  // дату закрытия и исказил время до решения.
  const aviso = updated
    ? null
    : "Este caso já está encerrado.";

  res.redirect(
    303,
    `/caso/${found.case.publicId}${aviso ? `?aviso=${encodeURIComponent(aviso)}` : ""}`,
  );
}

export async function reabrir(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  await reopenCase(found.case);
  res.redirect(303, `/caso/${found.case.publicId}`);
}

export async function situacaoPix(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isPixSituation(body.situacao)) return next();

  const updated = await setPixSituation({
    caseRecord: found.case,
    situation: body.situacao,
    label: pixSituationDefinition(body.situacao).label,
  });

  const aviso = updated
    ? null
    : "Esta pergunta vale para casos pagos com Pix.";

  res.redirect(
    303,
    `/caso/${found.case.publicId}${aviso ? `?aviso=${encodeURIComponent(aviso)}` : "#pix"}`,
  );
}

export async function escalar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const level = ESCALATION_ORDER.find(
    (item): item is EscalationStep => item === body.canal && item !== "NENHUM",
  );
  if (!level) return next();

  const updated = await escalateCase({
    caseRecord: found.case,
    level,
    label: ESCALATION_LABELS[level],
  });

  const aviso = updated ? null : "Não é possível escalonar um caso encerrado.";

  res.redirect(
    303,
    `/caso/${found.case.publicId}${aviso ? `?aviso=${encodeURIComponent(aviso)}` : ""}`,
  );
}
