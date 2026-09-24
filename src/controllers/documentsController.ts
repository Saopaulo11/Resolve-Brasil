import type { NextFunction, Request, Response } from "express";

import { getCaseForUser } from "../cases/caseService";
import {
  extractFromDocument,
  readDocument,
  removeDocument,
  reviewFact,
  uploadDocuments,
  UPLOAD_MESSAGES,
  type BatchUploadResult,
  type FactDecision,
} from "../documents/documentService";
import type { DocumentKind } from "../generated/prisma/enums";
import { uploadedFiles } from "../middleware/upload";
import { ipPrefix } from "../utils/crypto";
import { isValidPublicCaseId } from "../utils/ids";
import { stores } from "../users/storeRegistry";

/**
 * Документы дела (§23–§26).
 *
 * Все маршруты начинаются с одной и той же проверки: дело существует и
 * принадлежит вошедшему. Чужое и несуществующее дело неотличимы — оба
 * дают 404.
 */
const KINDS: readonly DocumentKind[] = [
  "NOTA_FISCAL",
  "COMPROVANTE_PIX",
  "PEDIDO",
  "CONTRATO",
  "CAPTURA_DE_TELA",
  "EMAIL",
  "CONVERSA",
  "RESPOSTA_DA_EMPRESA",
  "OUTRO",
];

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

/**
 * Что сказать после отправки.
 *
 * Молча теряется только то, о чём не сказали: принятые файлы человек видит
 * в списке сам, а про каждый отвергнутый нужно назвать файл и причину —
 * иначе он не поймёт, почему из пяти снимков дошли четыре.
 */
function avisoDeEnvio(result: BatchUploadResult): string | null {
  if (result.recusados.length === 0) return null;

  const detalhes = result.recusados
    .map((item) => `${item.filename}: ${UPLOAD_MESSAGES[item.reason]}`)
    .join(" ");

  return result.enviados.length > 0
    ? `Parte dos arquivos não foi aceita. ${detalhes}`
    : detalhes;
}

export async function enviar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = KINDS.find((item) => item === body.tipo) ?? "OUTRO";

  const result = await uploadDocuments({
    caseRecord: found.case,
    userId,
    files: uploadedFiles(req),
    kind,
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  const target = `/caso/${found.case.publicId}`;
  const aviso = avisoDeEnvio(result);

  if (!aviso) {
    res.redirect(303, `${target}#documentos`);
    return;
  }

  res.redirect(303, `${target}?aviso=${encodeURIComponent(aviso)}`);
}

export async function remover(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const documentId = typeof req.params.documentId === "string" ? req.params.documentId : "";
  if (documentId.length === 0) return next();

  const result = await removeDocument({
    documentId,
    userId,
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  const target = `/caso/${found.case.publicId}`;
  if (result.ok) {
    res.redirect(303, `${target}#documentos`);
    return;
  }

  res.redirect(
    303,
    `${target}?aviso=${encodeURIComponent("Não foi possível remover esse arquivo.")}#documentos`,
  );
}

/**
 * Выдача файла.
 *
 * Документ отдаётся только владельцу и только этим маршрутом: публичной
 * ссылки у него нет ни на одном шаге (§25). Заголовки запрещают браузеру
 * угадывать тип и открывать файл как страницу — иначе загруженный HTML
 * выполнился бы в нашем origin.
 */
export async function baixar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const documentId = typeof req.params.documentId === "string" ? req.params.documentId : "";
  if (documentId.length === 0) return next();

  const result = await readDocument({
    documentId,
    userId,
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  if (!result.ok) return next();

  res.setHeader("Content-Type", result.document.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(result.document.filename)}`,
  );
  // Приватный файл не должен оседать в промежуточных кешах.
  res.setHeader("Cache-Control", "private, no-store");
  res.send(result.data);
}

export async function extrair(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const documentId = typeof req.params.documentId === "string" ? req.params.documentId : "";
  const document = await stores().documents.findById(documentId);

  // Документ обязан принадлежать именно этому делу.
  if (!document || document.caseId !== found.case.id || document.deletedAt) {
    return next();
  }

  const result = await extractFromDocument({
    document,
    caseRecord: found.case,
    userId,
  });

  const target = `/caso/${found.case.publicId}`;
  if (result.ok) {
    res.redirect(303, `${target}#dados-extraidos`);
    return;
  }

  res.redirect(303, `${target}?aviso=${encodeURIComponent(result.detail)}`);
}

const DECISIONS: readonly FactDecision[] = ["confirmar", "corrigir", "rejeitar"];

export async function revisarFato(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const found = await resolveCase(req, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const decision = DECISIONS.find((item) => item === body.decisao);
  const factId = typeof req.params.factId === "string" ? req.params.factId : "";

  if (!decision || factId.length === 0) return next();

  const ok = await reviewFact({
    factId,
    caseRecord: found.case,
    decision,
    correctedValue: typeof body.valor === "string" ? body.valor : null,
  });

  if (!ok) return next();

  res.redirect(303, `/caso/${found.case.publicId}#dados-extraidos`);
}
