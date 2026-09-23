import { runStructured } from "../openai/client";
import {
  buildActionPlanPrompt,
  ACTION_PLAN_PROMPT_VERSION,
} from "../prompts/actionPlan";
import {
  buildClassifierPrompt,
  CASE_CLASSIFIER_PROMPT_VERSION,
} from "../prompts/classifier";
import {
  buildDocumentExtractionPrompt,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
} from "../prompts/documentExtraction";
import { buildDraftPrompt, DRAFT_PROMPT_VERSION } from "../prompts/draft";
import { buildQuestionsPrompt, QUESTIONS_PROMPT_VERSION } from "../prompts/questions";
import {
  buildResponseAnalysisPrompt,
  RESPONSE_ANALYSIS_PROMPT_VERSION,
} from "../prompts/responseAnalysis";
import { buildSourcesPrompt, SOURCES_PROMPT_VERSION } from "../prompts/sources";
import { buildSummaryPrompt, SUMMARY_PROMPT_VERSION } from "../prompts/summary";
import {
  actionPlanSchema,
  caseClassificationSchema,
  caseSummarySchema,
  documentExtractionSchema,
  draftSchema,
  questionsSchema,
  responseAnalysisSchema,
  sourceSearchSchema,
  type ActionPlan,
  type CaseClassification,
  type CaseSummary,
  type DocumentExtraction,
  type Draft,
  type Questions,
  type ResponseAnalysis,
  type SourceSearch,
} from "../schemas";
import type {
  AIProvider,
  AiResult,
  CaseContext,
  CompanyResponseInput,
  DocumentInput,
  OfficialSourceOption,
} from "./AIProvider";

/**
 * Документ как часть запроса.
 *
 * PDF уходит как input_file, картинка — как input_image: это разные типы
 * содержимого в Responses API. Файл передаётся data-URL внутри запроса и
 * не загружается в постоянное хранилище провайдера — вместе с store: false
 * это значит, что копии документа у него не остаётся.
 */
function documentPart(document: DocumentInput): Record<string, unknown> {
  const base64 = document.data.toString("base64");
  const dataUrl = `data:${document.mimeType};base64,${base64}`;

  if (document.mimeType === "application/pdf") {
    return { type: "input_file", filename: document.filename, file_data: dataUrl };
  }

  return { type: "input_image", detail: "auto", image_url: dataUrl };
}

/**
 * Основной провайдер (§6).
 *
 * Здесь только сборка запроса и возврат проверенного результата. Правила
 * поведения живут в src/ai/prompts, проверка ответа — в runStructured,
 * учёт вызовов — в aiRequestLog. Бизнес-логика этот класс не видит: она
 * работает с интерфейсом AIProvider (§7).
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;

  async classifyCase(context: CaseContext): Promise<AiResult<CaseClassification>> {
    const prompt = buildClassifierPrompt(context);
    return runStructured({
      operation: "classifyCase",
      promptVersion: CASE_CLASSIFIER_PROMPT_VERSION,
      schemaName: "case_classification",
      schema: caseClassificationSchema,
      ...prompt,
    });
  }

  async generateQuestions(context: CaseContext): Promise<AiResult<Questions>> {
    const prompt = buildQuestionsPrompt(context);
    return runStructured({
      operation: "generateQuestions",
      promptVersion: QUESTIONS_PROMPT_VERSION,
      schemaName: "questions",
      schema: questionsSchema,
      ...prompt,
    });
  }

  async createActionPlan(
    context: CaseContext,
    sources: OfficialSourceOption[],
  ): Promise<AiResult<ActionPlan>> {
    const prompt = buildActionPlanPrompt(context, sources);
    const result = await runStructured({
      operation: "createActionPlan",
      promptVersion: ACTION_PLAN_PROMPT_VERSION,
      schemaName: "action_plan",
      schema: actionPlanSchema,
      ...prompt,
    });

    // Тот же рубеж, что и в поиске источников: схема проверяет форму URL,
    // а не происхождение. Ссылка, которой мы не давали, отбрасывается —
    // в плане действий выдуманный gov.br опаснее всего, потому что там он
    // выглядит как подтверждение процедуры (§30).
    const allowed = new Set(sources.map((source) => source.url));
    const filtered = result.data.sources.filter((source) => allowed.has(source.url));
    const dropped = result.data.sources.length - filtered.length;

    return {
      data: {
        ...result.data,
        sources: filtered,
        uncertainties:
          dropped > 0
            ? [
                ...result.data.uncertainties,
                "Não foi possível confirmar essa informação em uma fonte oficial.",
              ]
            : result.data.uncertainties,
      },
      meta: result.meta,
    };
  }

  async createDraft(context: CaseContext): Promise<AiResult<Draft>> {
    const prompt = buildDraftPrompt(context);
    return runStructured({
      operation: "createDraft",
      promptVersion: DRAFT_PROMPT_VERSION,
      schemaName: "draft",
      schema: draftSchema,
      ...prompt,
    });
  }

  async analyzeResponse(
    context: CaseContext,
    response: CompanyResponseInput,
  ): Promise<AiResult<ResponseAnalysis>> {
    const prompt = buildResponseAnalysisPrompt(context, response.text);
    return runStructured({
      operation: "analyzeResponse",
      promptVersion: RESPONSE_ANALYSIS_PROMPT_VERSION,
      schemaName: "response_analysis",
      schema: responseAnalysisSchema,
      ...prompt,
    });
  }

  async extractDocument(document: DocumentInput): Promise<AiResult<DocumentExtraction>> {
    const prompt = buildDocumentExtractionPrompt(document);

    return runStructured({
      operation: "extractDocument",
      promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
      schemaName: "document_extraction",
      schema: documentExtractionSchema,
      instructions: prompt.instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt.userText },
            documentPart(document),
          ],
        },
      ],
    });
  }

  async summarizeCase(context: CaseContext): Promise<AiResult<CaseSummary>> {
    const prompt = buildSummaryPrompt(context);
    return runStructured({
      operation: "summarizeCase",
      promptVersion: SUMMARY_PROMPT_VERSION,
      schemaName: "case_summary",
      schema: caseSummarySchema,
      ...prompt,
    });
  }

  async searchSources(
    query: string,
    category: string | null,
    candidates: OfficialSourceOption[],
  ): Promise<AiResult<SourceSearch>> {
    // Пустой список — отвечаем «не нашли», не тратя вызов. Модели нечего
    // выбирать, а просить её «вспомнить» ссылку нельзя (§30).
    if (candidates.length === 0) {
      return {
        data: { sources: [], not_found: true },
        meta: {
          provider: "openai",
          model: "",
          operation: "searchSources",
          promptVersion: SOURCES_PROMPT_VERSION,
          inputTokens: null,
          outputTokens: null,
          latencyMs: 0,
          success: true,
          errorCode: null,
        },
      };
    }

    const prompt = buildSourcesPrompt(query, category, candidates);
    const result = await runStructured({
      operation: "searchSources",
      promptVersion: SOURCES_PROMPT_VERSION,
      schemaName: "source_search",
      schema: sourceSearchSchema,
      ...prompt,
    });

    // Последний рубеж: даже пройдя схему, ответ не должен содержать ссылку,
    // которой мы не давали. Схема проверяет форму URL, а не его происхождение.
    const allowed = new Set(candidates.map((candidate) => candidate.url));
    const filtered = result.data.sources.filter((source) => allowed.has(source.url));

    return {
      data: {
        sources: filtered,
        not_found: filtered.length === 0,
      },
      meta: result.meta,
    };
  }
}
