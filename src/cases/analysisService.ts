import { aiProvider } from "../ai";
import { buildCaseContext } from "../ai/context";
import { recordAiRequest } from "../ai/aiRequestLog";
import { AiError } from "../ai/openai/client";
import type { OfficialSourceOption } from "../ai/providers/AIProvider";
import { loadConfig } from "../config/env";
import type { MessageType } from "../generated/prisma/enums";
import { db, isDatabaseConfigured } from "../services/db";
import { trackEvent } from "../analytics/events";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import type { CaseEventRecord, CaseMessageRecord, CaseRecord } from "./caseStore";

/**
 * Запуск анализа дела (§8, §27, §28, §33, §34).
 *
 * Здесь сходятся три обязательства: результат модели проходит валидацию,
 * каждый вызов попадает в учёт (§45), и ничего непроверенного не становится
 * фактом дела (§87).
 */
export type AnalysisKind = "classificar" | "perguntas" | "plano" | "rascunho";

export type AnalysisOutcome =
  | { ok: true; message: CaseMessageRecord }
  | { ok: false; reason: "sem_ia" | "falhou"; detail: string };

const MESSAGE_TYPE: Record<AnalysisKind, MessageType> = {
  classificar: "CLASSIFICACAO",
  perguntas: "PERGUNTAS",
  plano: "PLANO_DE_ACAO",
  rascunho: "RASCUNHO",
};

/** Короткая подпись сообщения. Содержимое лежит в metadata. */
const MESSAGE_TITLE: Record<AnalysisKind, string> = {
  classificar: "Análise inicial do caso",
  perguntas: "Perguntas para avançar",
  plano: "Plano de ação",
  rascunho: "Mensagem para a empresa",
};

/**
 * Официальные источники для плана действий (§29).
 *
 * Модель выбирает только из этого списка. Пустой список — законное
 * состояние: план тогда честно скажет, что процедуру подтвердить не удалось.
 */
async function officialSources(): Promise<OfficialSourceOption[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await db().officialSource.findMany({
      where: { active: true },
      select: { organization: true, title: true, url: true },
      take: 20,
    });
    return rows;
  } catch (error) {
    logger().warn({ err: error }, "falha ao ler fontes oficiais");
    return [];
  }
}

export async function runAnalysis(input: {
  caseRecord: CaseRecord;
  timeline: CaseEventRecord[];
  userId: string;
  kind: AnalysisKind;
}): Promise<AnalysisOutcome> {
  const provider = aiProvider();

  // Заглушка не притворяется анализом (§79): вместо пустого результата,
  // который примут за ответ модели, говорим прямо, что AI не настроен.
  if (provider.name === "mock") {
    return {
      ok: false,
      reason: "sem_ia",
      detail:
        "A análise por IA não está configurada neste ambiente. " +
        "Nenhuma análise foi executada.",
    };
  }

  const context = buildCaseContext({
    case: input.caseRecord,
    timeline: input.timeline,
  });

  try {
    const result =
      input.kind === "classificar"
        ? await provider.classifyCase(context)
        : input.kind === "perguntas"
          ? await provider.generateQuestions(context)
          : input.kind === "plano"
            ? await provider.createActionPlan(context, await officialSources())
            : await provider.createDraft(context);

    const aiRequestId = await recordAiRequest(result.meta);

    const message = await stores().cases.addMessage({
      caseId: input.caseRecord.id,
      userId: null,
      direction: "ASSISTANT",
      type: MESSAGE_TYPE[input.kind],
      content: MESSAGE_TITLE[input.kind],
      metadata: result.data,
      aiRequestId,
    });

    if (input.kind === "classificar") {
      await applyClassification(input.caseRecord, result.data as {
        category: string;
        subcategory: string | null;
        confidence: number;
      }, input.userId);
    }

    void trackEvent(
      input.kind === "plano" ? "action_plan_viewed" : "draft_created",
      { userId: input.userId },
    );

    return { ok: true, message };
  } catch (error) {
    // Неудача тоже попадает в учёт: по одним успехам не видно доли отказов.
    if (error instanceof AiError && error.meta) {
      await recordAiRequest(error.meta);
    }

    logger().error(
      { err: error, kind: input.kind, publicId: input.caseRecord.publicId },
      "análise de IA falhou",
    );

    return {
      ok: false,
      reason: "falhou",
      detail: "Não foi possível concluir a análise agora. Tente novamente.",
    };
  }
}

/**
 * Классификация становится категорией дела только при достаточной
 * уверенности (§87). Ниже порога она остаётся предположением: неверная
 * категория с виду уверенного ответа уводит дело не туда, и заметить это
 * потом некому.
 */
async function applyClassification(
  caseRecord: CaseRecord,
  classification: { category: string; subcategory: string | null; confidence: number },
  userId: string,
): Promise<void> {
  const threshold = loadConfig().ai.classificationMinConfidence;
  if (classification.confidence < threshold) return;
  if (classification.category === "OUTRO") return;

  await stores().cases.setClassification(
    caseRecord.id,
    classification.category as never,
    classification.subcategory,
  );

  void trackEvent("case_category_changed", {
    userId,
    properties: { category: classification.category },
  });
}
