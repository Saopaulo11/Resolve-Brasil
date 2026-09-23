import { aiProvider } from "../ai";
import { recordAiRequest } from "../ai/aiRequestLog";
import { buildCaseContext } from "../ai/context";
import { AiError } from "../ai/openai/client";
import type { CompanyResponseInput } from "../ai/providers/AIProvider";
import { trackEvent } from "../analytics/events";
import { refreshProjection } from "../analytics/pipeline";
import { confirmedFacts } from "../documents/documentService";
import { uploadDocument, UPLOAD_MESSAGES, type UploadError } from "../documents/documentService";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import type { CaseEventRecord, CaseRecord } from "./caseStore";

/**
 * «Recebi uma resposta» (§35).
 *
 * Ключевая функция продукта: человек приносит ответ компании и должен
 * получить четыре вещи — что ответили, что это значит, что осталось без
 * ответа и что можно сделать дальше.
 *
 * Ответ принимается и текстом, и файлом. Требовать перепечатать текст со
 * скриншота — верный способ потерять пользователя ровно там, где он уже
 * дошёл до половины пути.
 */
export type ResponseInput =
  | { kind: "texto"; text: string }
  | {
      kind: "arquivo";
      file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;
    };

export type RecordResponseOutcome =
  | { ok: true }
  | { ok: false; reason: "sem_ia" | "falhou" | "vazio" | UploadError; detail: string };

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 20_000;

export async function recordCompanyResponse(input: {
  caseRecord: CaseRecord;
  timeline: CaseEventRecord[];
  userId: string;
  input: ResponseInput;
  ipPrefix: string | null;
}): Promise<RecordResponseOutcome> {
  const provider = aiProvider();

  // Заглушка не притворяется разбором (§79). Проверяем это до приёма файла:
  // иначе документ был бы сохранён, а разбора всё равно не случилось бы.
  if (provider.name === "mock") {
    return {
      ok: false,
      reason: "sem_ia",
      detail:
        "A análise de respostas não está configurada neste ambiente. " +
        "Nenhuma análise foi executada.",
    };
  }

  const prepared = await prepareResponse(input);
  if (!prepared.ok) return prepared;

  const { cases } = stores();

  // Сам ответ сохраняется как сообщение пользователя: это факт дела, и он
  // должен остаться, даже если разбор потом не удастся.
  await cases.addMessage({
    caseId: input.caseRecord.id,
    userId: input.userId,
    direction: "USER",
    type: "TEXTO",
    content: prepared.summary,
    metadata: null,
    aiRequestId: null,
  });

  await cases.addEvent({
    caseId: input.caseRecord.id,
    type: "resposta_recebida",
    title: "Resposta da empresa recebida",
    description: null,
    eventDate: new Date(),
    source: "USER_FACT",
  });

  await cases.setStatus(input.caseRecord.id, "RESPOSTA_RECEBIDA");

  const updated = await cases.findById(input.caseRecord.id);
  if (updated) await refreshProjection(updated);

  void trackEvent("response_uploaded", { userId: input.userId });

  const context = buildCaseContext({
    case: input.caseRecord,
    timeline: input.timeline,
    confirmedFacts: await confirmedFacts(input.caseRecord.id),
  });

  try {
    const result = await provider.analyzeResponse(context, prepared.forProvider);
    const aiRequestId = await recordAiRequest(result.meta);

    await cases.addMessage({
      caseId: input.caseRecord.id,
      userId: null,
      direction: "ASSISTANT",
      type: "ANALISE_DE_RESPOSTA",
      content: "Análise da resposta da empresa",
      metadata: result.data,
      aiRequestId,
    });

    void trackEvent("response_analyzed", { userId: input.userId });
    return { ok: true };
  } catch (error) {
    if (error instanceof AiError && error.meta) await recordAiRequest(error.meta);

    logger().error(
      { err: error, publicId: input.caseRecord.publicId },
      "análise da resposta falhou",
    );

    // Ответ уже сохранён и статус обновлён — потерянным он не окажется.
    return {
      ok: false,
      reason: "falhou",
      detail:
        "Recebemos a resposta, mas não foi possível analisá-la agora. " +
        "Tente a análise novamente em instantes.",
    };
  }
}

type Prepared =
  | { ok: true; summary: string; forProvider: CompanyResponseInput }
  | { ok: false; reason: "vazio" | UploadError; detail: string };

/**
 * Приведение ответа к виду, который уходит модели.
 *
 * Файл проходит тот же путь, что и любой документ дела: проверка типа по
 * содержимому, приватное хранилище, запись в журнал. Отдельной «облегчённой»
 * дороги для файлов здесь нет — иначе через неё и загружали бы что угодно.
 */
async function prepareResponse(input: {
  caseRecord: CaseRecord;
  userId: string;
  input: ResponseInput;
  ipPrefix: string | null;
}): Promise<Prepared> {
  if (input.input.kind === "texto") {
    const text = input.input.text.trim();

    if (text.length < MIN_TEXT_LENGTH) {
      return {
        ok: false,
        reason: "vazio",
        detail: "Cole o texto da resposta da empresa, ou envie um arquivo.",
      };
    }

    return {
      ok: true,
      summary: text.slice(0, MAX_TEXT_LENGTH),
      forProvider: { kind: "texto", text: text.slice(0, MAX_TEXT_LENGTH) },
    };
  }

  const uploaded = await uploadDocument({
    caseRecord: input.caseRecord,
    userId: input.userId,
    file: input.input.file,
    kind: "RESPOSTA_DA_EMPRESA",
    ipPrefix: input.ipPrefix,
  });

  if (!uploaded.ok) {
    return { ok: false, reason: uploaded.reason, detail: UPLOAD_MESSAGES[uploaded.reason] };
  }

  return {
    ok: true,
    summary: `Resposta enviada como arquivo: ${uploaded.document.filename}`,
    forProvider: {
      kind: "documento",
      filename: uploaded.document.filename,
      mimeType: uploaded.document.mimeType,
      data: input.input.file!.buffer,
    },
  };
}

export { MIN_TEXT_LENGTH, MAX_TEXT_LENGTH };
