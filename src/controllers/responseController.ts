import type { NextFunction, Request, Response } from "express";

import { getCaseForUser } from "../cases/caseService";
import { recordCompanyResponse, type ResponseInput } from "../cases/responseService";
import { uploadedFiles } from "../middleware/upload";
import { ipPrefix } from "../utils/crypto";
import { isValidPublicCaseId } from "../utils/ids";

/**
 * Приём ответа компании (§35).
 *
 * Форма принимает и вставленный текст, и файл. Если пришло и то и другое,
 * побеждает файл: человек приложил именно его, а текст мог остаться в поле
 * с прошлой попытки.
 */
export async function receber(
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const texto = typeof body.texto === "string" ? body.texto : "";

  // Ответ компании — один документ: скриншот или письмо. Если человек
  // выбрал несколько, берём первый, а не молча отбрасываем все.
  const [arquivo] = uploadedFiles(req);

  const input: ResponseInput = arquivo
    ? { kind: "arquivo", file: arquivo }
    : { kind: "texto", text: texto };

  const outcome = await recordCompanyResponse({
    caseRecord: found.case,
    timeline: found.timeline,
    userId,
    input,
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  const target = `/caso/${publicId}`;
  if (outcome.ok) {
    res.redirect(303, `${target}#resposta`);
    return;
  }

  res.redirect(303, `${target}?aviso=${encodeURIComponent(outcome.detail)}#resposta`);
}
