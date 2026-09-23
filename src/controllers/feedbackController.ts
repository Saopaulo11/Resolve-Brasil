import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { getCaseForUser } from "../cases/caseService";
import { FEEDBACK_REASONS } from "../cases/feedbackLabels";
import { trackEvent } from "../analytics/events";
import { isValidPublicCaseId } from "../utils/ids";
import { stores } from "../users/storeRegistry";

/**
 * Оценка ответа AI (§52).
 *
 * Без неё нечем измерить, помогает система или нет, и качество остаётся
 * вопросом мнения. Поэтому оценка привязывается к конкретному сообщению, а
 * не к делу целиком: «не помогло» без указания, что именно не помогло, ни о
 * чём не говорит.
 */
const schema = z.object({
  mensagem: z.string().min(1).max(100),
  avaliacao: z.enum(["SIM", "NAO"]),
  motivo: z.string().optional(),
  comentario: z.string().trim().max(1000).optional(),
});

export async function avaliar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const raw = req.params.publicId;
  const publicId = typeof raw === "string" ? raw : "";
  if (!isValidPublicCaseId(publicId)) return next();

  const found = await getCaseForUser(publicId, userId);
  if (!found) return next();

  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return next();

  const { feedback, cases } = stores();

  // Сообщение обязано принадлежать этому делу: иначе оценку можно было бы
  // привязать к чужому ответу.
  const messages = await cases.listMessages(found.case.id);
  const message = messages.find((item) => item.id === parsed.data.mensagem);
  if (!message) return next();

  // Повторная оценка не создаёт вторую запись: иначе одно мнение
  // засчитывалось бы столько раз, сколько человек нажал кнопку.
  const existing = await feedback.findForMessage(message.id, userId);
  if (!existing) {
    const reason = FEEDBACK_REASONS.find((item) => item === parsed.data.motivo) ?? null;

    await feedback.create({
      userId,
      caseId: found.case.id,
      messageId: message.id,
      rating: parsed.data.avaliacao,
      reason: parsed.data.avaliacao === "NAO" ? reason : null,
      comment: parsed.data.comentario || null,
    });

    void trackEvent("feedback_submitted", { userId });
  }

  res.redirect(303, `/caso/${publicId}#avaliacao-${message.id}`);
}
