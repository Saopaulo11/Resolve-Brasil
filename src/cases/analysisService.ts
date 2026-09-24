import { aiProvider } from "../ai";
import { buildCaseContext } from "../ai/context";
import { recordAiRequest } from "../ai/aiRequestLog";
import { AiError } from "../ai/openai/client";
import type { OfficialSourceOption } from "../ai/providers/AIProvider";
import { loadConfig } from "../config/env";
import type { MessageType } from "../generated/prisma/enums";
import { confirmedFacts } from "../documents/documentService";
import { usableSourceOptions } from "../sources/sourceService";
import { trackEvent } from "../analytics/events";
import { refreshProjection } from "../analytics/pipeline";
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
 * Официальные источники для плана действий (§29, §32).
 *
 * Модель выбирает только из этого списка, и в него попадают лишь
 * подтверждённые и не устаревшие источники. Пустой список — законное
 * состояние: план тогда честно скажет, что процедуру подтвердить не удалось.
 */
async function officialSources(): Promise<OfficialSourceOption[]> {
  try {
    return await usableSourceOptions();
  } catch (error) {
    logger().warn({ err: error }, "falha ao ler fontes oficiais");
    return [];
  }
}

export async function runAnalysis(input: {
  caseRecord: CaseRecord;
  timeline: CaseEventRecord[];
  /**
   * Кто запустил разбор. null — тот, кто завёл дело и ещё не вошёл (§15).
   *
   * Используется только учётом событий, и он null принимает: в аналитике
   * человека всё равно нет, туда идут обезличенные счётчики (§55).
   */
  userId: string | null;
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
    // Только подтверждённые человеком факты (§5, §26). Извлечённое моделью
    // и не проверенное пользователем к ней же как факт не возвращается —
    // иначе её собственная догадка закрепится как установленное.
    confirmedFacts: await confirmedFacts(input.caseRecord.id),
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

    if (input.kind === "plano") {
      await linkPlanSources(input.caseRecord.id, result.data as { sources?: unknown });
    }

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
 * Запоминает, на какие источники опёрся план (§31).
 *
 * Без этой связи вопрос «откуда это взялось» остаётся без ответа: план
 * показывает ссылки сейчас, а через месяц непонятно, что именно ими
 * подтверждалось.
 *
 * Связываются только источники, уже лежащие в нашей базе: адрес, который
 * модель вернула сама, туда не попал и попасть не должен (§30).
 */
async function linkPlanSources(caseId: string, plan: { sources?: unknown }): Promise<void> {
  const sources = Array.isArray(plan.sources) ? plan.sources : [];
  if (sources.length === 0) return;

  const store = stores().sources;

  for (const item of sources) {
    const url = (item as { url?: unknown }).url;
    const title = (item as { title?: unknown }).title;
    if (typeof url !== "string" || typeof title !== "string") continue;

    const known = await store.findByUrl(url);
    if (!known) continue;

    try {
      await store.linkToCase({ caseId, sourceId: known.id, claim: title.slice(0, 300) });
    } catch (error) {
      // Учёт источников не имеет права ломать выдачу плана человеку.
      logger().warn({ err: error, url }, "falha ao vincular fonte ao caso");
    }
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
  userId: string | null,
): Promise<void> {
  const threshold = loadConfig().ai.classificationMinConfidence;
  if (classification.confidence < threshold) return;
  if (classification.category === "OUTRO") return;

  await stores().cases.setClassification(
    caseRecord.id,
    classification.category as never,
    classification.subcategory,
  );

  const updated = await stores().cases.findById(caseRecord.id);
  if (updated) {
    await refreshProjection(updated, { confidence: classification.confidence });
  }

  void trackEvent("case_category_changed", {
    userId,
    properties: { category: classification.category },
  });
}
