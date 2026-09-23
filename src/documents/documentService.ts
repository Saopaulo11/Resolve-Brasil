import { aiProvider } from "../ai";
import { AiError } from "../ai/openai/client";
import { recordAiRequest } from "../ai/aiRequestLog";
import { refreshProjection } from "../analytics/pipeline";
import type { CaseFieldsUpdate, CaseRecord } from "../cases/caseStore";
import { fieldsFromFacts } from "../cases/factFields";
import { resolveCompany } from "../companies/companyService";
import type { DocumentKind } from "../generated/prisma/enums";
import { trackEvent } from "../analytics/events";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import {
  buildStorageKey,
  checksum,
  storageProvider,
  UPLOAD_ERROR_MESSAGES,
  validateUpload,
  type UploadValidationError,
} from "./storage";
import { declaredMatchesActual, detectFileType } from "./fileType";
import type { CaseFactRecord, DocumentRecord } from "./documentStore";

/**
 * Документы дела (§23–§26).
 *
 * Файл не бывает публичным ни на одном шаге: он кладётся в приватное
 * хранилище под ключом, не содержащим имени пользовательского файла, и
 * отдаётся только через маршрут, который проверяет владельца и пишет
 * обращение в журнал.
 */

export type UploadError = UploadValidationError | "conteudo_nao_confere" | "sem_arquivo";

export const UPLOAD_MESSAGES: Record<UploadError, string> = {
  ...UPLOAD_ERROR_MESSAGES,
  sem_arquivo: "Selecione um arquivo para enviar.",
  conteudo_nao_confere:
    "O conteúdo do arquivo não corresponde ao tipo declarado. Envie PDF, JPG, PNG ou WEBP.",
};

export type UploadResult =
  | { ok: true; document: DocumentRecord }
  | { ok: false; reason: UploadError };

/**
 * Антивирусная проверка (§25).
 *
 * Не реализована. Архитектурно место для неё здесь, и статус хранится у
 * каждого документа, чтобы потом можно было отличить проверенные файлы от
 * загруженных до появления проверки. Возвращать «чисто» без проверки
 * нельзя: это выглядело бы как гарантия, которой нет.
 */
const SCAN_STATUS_NOT_CHECKED = "NAO_VERIFICADO";

export async function uploadDocument(input: {
  caseRecord: CaseRecord;
  userId: string;
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;
  kind: DocumentKind;
  ipPrefix: string | null;
}): Promise<UploadResult> {
  const { file } = input;
  if (!file || file.size === 0) return { ok: false, reason: "sem_arquivo" };

  // Сначала то, что заявил клиент: размер, тип, расширение.
  const declaredError = validateUpload({
    filename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  });
  if (declaredError) return { ok: false, reason: declaredError };

  // Затем то, что внутри. Заявленный тип подделывается переименованием
  // файла, сигнатура в первых байтах — нет (§25).
  const actual = detectFileType(file.buffer);
  if (!actual || !declaredMatchesActual(file.mimetype, actual)) {
    logger().warn(
      { declared: file.mimetype, actual, caseId: input.caseRecord.publicId },
      "upload recusado: conteúdo não corresponde ao tipo declarado",
    );
    return { ok: false, reason: "conteudo_nao_confere" };
  }

  const storageKey = buildStorageKey(input.caseRecord.id, actual);
  await storageProvider().put(storageKey, file.buffer, actual);

  const document = await stores().documents.create({
    caseId: input.caseRecord.id,
    userId: input.userId,
    // Имя файла сохраняется для показа, но в путь хранения не попадает.
    filename: file.originalname.slice(0, 255),
    mimeType: actual,
    fileSize: file.size,
    storageKey,
    kind: input.kind,
    checksumSha256: checksum(file.buffer),
    scanStatus: SCAN_STATUS_NOT_CHECKED,
  });

  await stores().audit.record({
    adminUserId: null,
    action: "document.upload",
    entityType: "Document",
    entityId: document.id,
    metadata: { caseId: input.caseRecord.publicId, mimeType: actual, size: file.size },
    ipPrefix: input.ipPrefix,
  });

  await stores().cases.addEvent({
    caseId: input.caseRecord.id,
    type: "documento_enviado",
    title: "Documento enviado",
    description: document.filename,
    eventDate: document.createdAt,
    source: "USER_FACT",
  });

  void trackEvent("document_uploaded", { userId: input.userId });

  return { ok: true, document };
}

export type DownloadResult =
  | { ok: true; document: DocumentRecord; data: Buffer }
  | { ok: false };

/**
 * Выдача файла владельцу.
 *
 * Чужой и несуществующий документ неотличимы: оба дают отказ без
 * подробностей. Каждое обращение пишется в журнал (§25, §51) — по нему
 * потом видно, кто и когда получал доступ к персональным данным.
 */
export async function readDocument(input: {
  documentId: string;
  userId: string;
  ipPrefix: string | null;
}): Promise<DownloadResult> {
  const document = await stores().documents.findById(input.documentId);
  if (!document || document.deletedAt) return { ok: false };

  // Права проверяются по делу, а не по полю userId документа: владелец
  // дела мог измениться при привязке, а документ принадлежит делу.
  const caseRecord = await stores().cases.findById(document.caseId);
  if (!caseRecord || caseRecord.userId !== input.userId) {
    logger().warn(
      { documentId: document.id },
      "tentativa de acesso a documento de outro usuário",
    );
    return { ok: false };
  }

  await stores().audit.record({
    adminUserId: null,
    action: "document.read",
    entityType: "Document",
    entityId: document.id,
    metadata: { caseId: caseRecord.publicId },
    ipPrefix: input.ipPrefix,
  });

  try {
    return { ok: true, document, data: await storageProvider().get(document.storageKey) };
  } catch (error) {
    logger().error({ err: error, documentId: document.id }, "falha ao ler documento");
    return { ok: false };
  }
}

export type ExtractionResult =
  | { ok: true; facts: CaseFactRecord[] }
  | { ok: false; reason: "sem_ia" | "falhou"; detail: string };

/**
 * Извлечение данных из документа (§26).
 *
 * Запускается только явным действием пользователя: это единственная
 * операция, где наружу уходит сам файл, а не выборка полей.
 *
 * Ничто из извлечённого не считается подтверждённым. Факты создаются со
 * статусом UNCONFIRMED, и превратить их в факты дела может только человек.
 */
export async function extractFromDocument(input: {
  document: DocumentRecord;
  caseRecord: CaseRecord;
  userId: string;
}): Promise<ExtractionResult> {
  const provider = aiProvider();

  if (provider.name === "mock") {
    return {
      ok: false,
      reason: "sem_ia",
      detail:
        "A leitura automática de documentos não está configurada neste ambiente. " +
        "Nenhum dado foi extraído.",
    };
  }

  const { documents, facts } = stores();
  await documents.setExtractionStatus(input.document.id, "PROCESSANDO", null);

  try {
    const data = await storageProvider().get(input.document.storageKey);

    const result = await provider.extractDocument({
      filename: input.document.filename,
      mimeType: input.document.mimeType,
      data,
    });

    await recordAiRequest(result.meta);

    const created = await facts.createMany(
      result.data.fields.map((field) => ({
        caseId: input.caseRecord.id,
        documentId: input.document.id,
        field: field.field,
        value: field.value,
        // §5: извлечённое моделью — предположение, а не факт пользователя.
        source: "AI_SUGGESTION" as const,
        confidence: field.confidence,
      })),
    );

    await documents.setExtractionStatus(input.document.id, "CONCLUIDA", null);
    void trackEvent("document_processed", { userId: input.userId });

    return { ok: true, facts: created };
  } catch (error) {
    if (error instanceof AiError && error.meta) await recordAiRequest(error.meta);

    await documents.setExtractionStatus(
      input.document.id,
      "FALHOU",
      error instanceof AiError ? error.code : "ERRO",
    );

    logger().error(
      { err: error, documentId: input.document.id },
      "extração de documento falhou",
    );

    return {
      ok: false,
      reason: "falhou",
      detail: "Não foi possível ler o documento agora. Tente novamente.",
    };
  }
}

export type FactDecision = "confirmar" | "corrigir" | "rejeitar";

/**
 * Решение пользователя по извлечённому факту (§26).
 *
 * Подтверждение переводит факт в USER_FACT: с этого момента он становится
 * данными дела и может уходить модели как факт, а не как догадка.
 */
export async function reviewFact(input: {
  factId: string;
  caseRecord: CaseRecord;
  decision: FactDecision;
  correctedValue: string | null;
}): Promise<boolean> {
  const { facts } = stores();

  const fact = await facts.findById(input.factId);
  // Факт чужого дела не редактируется: проверка по делу, а не по идентификатору.
  if (!fact || fact.caseId !== input.caseRecord.id) return false;

  const now = new Date();

  if (input.decision === "rejeitar") {
    await facts.updateStatus(fact.id, "REJECTED", fact.value, now);
    // Отклонение тоже меняет картину: подтверждённое раньше могло уйти.
    await applyConfirmedFacts(input.caseRecord.id);
    return true;
  }

  if (input.decision === "corrigir") {
    const value = (input.correctedValue ?? "").trim();
    if (value.length === 0 || value.length > 500) return false;
    await facts.updateStatus(fact.id, "USER_CORRECTED", value, now);
    await applyConfirmedFacts(input.caseRecord.id);
    return true;
  }

  await facts.updateStatus(fact.id, "CONFIRMED", fact.value, now);
  await applyConfirmedFacts(input.caseRecord.id);
  return true;
}

/**
 * Переносит подтверждённые факты в поля дела (§26, §85).
 *
 * До этого подтверждение оставалось только в списке фактов: дело не знало
 * ни компании, ни суммы, ни способа оплаты. Из-за этого срез по компании
 * не находил ни одного дела, а отрасль в аналитике оставалась пустой не
 * потому, что её не определили, а потому, что компанию некуда было
 * записать.
 *
 * Пересчитывается весь набор, а не одно поле: пользователь мог отклонить
 * подтверждённое раньше, и тогда поле обязано опустеть, а не остаться от
 * прошлого решения.
 */
async function applyConfirmedFacts(caseId: string): Promise<void> {
  const { cases } = stores();

  const confirmed = await confirmedFacts(caseId);
  const parsed = fieldsFromFacts(confirmed);

  /**
   * Набор собирается целиком, с явными null.
   *
   * Иначе отклонённый факт оставлял бы поле от прошлого решения: человек
   * убрал сумму из дела, а дело её помнит — и она уходит в аналитику.
   */
  const update: CaseFieldsUpdate = {
    companyName: parsed.companyName ?? null,
    companyId: null,
    companyNormalized: null,
    amount: parsed.amount ?? null,
    purchaseDate: parsed.purchaseDate ?? null,
    promisedDate: parsed.promisedDate ?? null,
    // Способ оплаты не обнуляется в null: в схеме это перечисление без
    // пустого значения, и «неизвестно» у него называется DESCONHECIDO.
    paymentMethod: parsed.paymentMethod ?? "DESCONHECIDO",
  };

  if (parsed.paymentMethod) void trackEvent("payment_method_detected");

  if (parsed.companyName) {
    const company = await resolveCompany(parsed.companyName);
    if (company) {
      update.companyId = company.id;
      update.companyNormalized = company.normalized;
    }
  }

  await cases.setFields(caseId, update);

  // Слепок в аналитике пересобирается: иначе компания и сумма появятся в
  // деле, но не в отчёте, и расхождение никто не заметит.
  const updated = await cases.findById(caseId);
  if (updated) await refreshProjection(updated);
}

/** Подтверждённые факты дела — только они уходят модели как факты (§5). */
export async function confirmedFacts(
  caseId: string,
): Promise<Array<{ field: string; value: string }>> {
  const all = await stores().facts.listForCase(caseId);
  return all
    .filter((fact) => fact.status === "CONFIRMED" || fact.status === "USER_CORRECTED")
    .map((fact) => ({ field: fact.field, value: fact.value }));
}
