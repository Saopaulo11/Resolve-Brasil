import { NAO_CONFIRMADO_PT_BR } from "../disclaimer";
import type {
  AIProvider,
  AiResult,
  CaseContext,
  CompanyResponseInput,
  DocumentInput,
  OfficialSourceOption,
} from "./AIProvider";
import type {
  ActionPlan,
  CaseClassification,
  CaseSummary,
  DocumentExtraction,
  Draft,
  Questions,
  ResponseAnalysis,
  SourceSearch,
} from "../schemas";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Провайдер-заглушка для разработки и тестов, когда ключа модели нет.
 *
 * Он намеренно НЕ притворяется работающим AI: не придумывает категорию,
 * компанию, сроки, источники и планы действий. Правдоподобная выдумка здесь
 * опаснее пустоты — её легко принять за результат и отправить пользователю
 * (§9, §82). Поэтому он возвращает пустые структуры с нулевой уверенностью
 * и честной пометкой, что анализ не выполнялся.
 */
const MOCK_NOTE =
  "MOCK: nenhuma análise de IA foi executada. Configure AI_PROVIDER e a chave " +
  "do provedor para obter uma análise real.";

function meta(operation: string, startedAt: number): AiResult<never>["meta"] {
  return {
    provider: "mock",
    model: "mock",
    operation,
    promptVersion: null,
    inputTokens: null,
    outputTokens: null,
    latencyMs: Date.now() - startedAt,
    success: true,
    errorCode: null,
  };
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock" as const;

  async classifyCase(_context: CaseContext): Promise<AiResult<CaseClassification>> {
    const startedAt = Date.now();
    return {
      // Категория OUTRO с нулевой уверенностью: вызывающий код обязан
      // относиться к ней как к «не классифицировано», а не как к ответу.
      data: {
        category: "OUTRO",
        subcategory: null,
        confidence: 0,
        missing_information: [MOCK_NOTE],
        recommended_questions: [],
        risk_flags: [],
      },
      meta: meta("classifyCase", startedAt),
    };
  }

  async extractDocument(_document: DocumentInput): Promise<AiResult<DocumentExtraction>> {
    const startedAt = Date.now();
    return {
      data: { fields: [], notes: [MOCK_NOTE] },
      meta: meta("extractDocument", startedAt),
    };
  }

  async generateQuestions(_context: CaseContext): Promise<AiResult<Questions>> {
    const startedAt = Date.now();
    return { data: { questions: [] }, meta: meta("generateQuestions", startedAt) };
  }

  async createActionPlan(
    _context: CaseContext,
    _sources: OfficialSourceOption[],
  ): Promise<AiResult<ActionPlan>> {
    const startedAt = Date.now();
    return {
      data: { steps: [], sources: [], uncertainties: [MOCK_NOTE] },
      meta: meta("createActionPlan", startedAt),
    };
  }

  async createDraft(_context: CaseContext): Promise<AiResult<Draft>> {
    const startedAt = Date.now();
    return {
      data: { subject: "", body: "", facts_used: [], warnings: [MOCK_NOTE] },
      meta: meta("createDraft", startedAt),
    };
  }

  async analyzeResponse(
    _context: CaseContext,
    _response: CompanyResponseInput,
  ): Promise<AiResult<ResponseAnalysis>> {
    const startedAt = Date.now();
    return {
      data: {
        what_company_said: "",
        what_it_means: MOCK_NOTE,
        what_is_missing: [],
        possible_next_action: "",
        suggested_reply: null,
      },
      meta: meta("analyzeResponse", startedAt),
    };
  }

  async summarizeCase(_context: CaseContext): Promise<AiResult<CaseSummary>> {
    const startedAt = Date.now();
    return {
      data: { summary: "", open_points: [MOCK_NOTE] },
      meta: meta("summarizeCase", startedAt),
    };
  }

  async searchSources(
    _query: string,
    _category: string | null,
    _candidates: OfficialSourceOption[],
  ): Promise<AiResult<SourceSearch>> {
    const startedAt = Date.now();
    // not_found: true — вызывающий код покажет «não foi possível confirmar»
    // вместо выдуманной ссылки на gov.br (§30, §32).
    return {
      data: { sources: [], not_found: true },
      meta: meta("searchSources", startedAt),
    };
  }
}

export { MOCK_NOTE, NAO_CONFIRMADO_PT_BR };
