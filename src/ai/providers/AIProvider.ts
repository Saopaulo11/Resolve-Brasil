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
 * Контракт AI-провайдера (§7).
 *
 * Бизнес-логика работает только с этим интерфейсом. Смена модели не должна
 * приводить к переписыванию логики дел: провайдер меняется переменной
 * AI_PROVIDER, всё остальное остаётся на месте.
 */

/**
 * Выборка данных дела, которую разрешено отправить модели (§47, §48).
 *
 * Здесь намеренно нет телефона, email, CPF, адреса, идентификатора
 * транзакции Pix и сырых документов. Тип — это и есть граница минимизации:
 * чтобы отправить модели что-то ещё, придётся осознанно менять контракт.
 */
export type CaseContext = {
  publicId: string;
  description: string;
  category: string | null;
  subcategory: string | null;
  companyName: string | null;
  /// Строкой, чтобы не потерять копейки на числах с плавающей точкой.
  amount: string | null;
  currency: string;
  paymentMethod: string | null;
  purchaseDate: string | null;
  promisedDate: string | null;
  status: string;
  /// Только подтверждённые факты (§5 USER FACT).
  confirmedFacts: Array<{ field: string; value: string }>;
  timeline: Array<{ date: string; title: string }>;
};

export type DocumentInput = {
  filename: string;
  mimeType: string;
  /// Текст, уже извлечённый из файла. Сам файл провайдеру не передаётся.
  text: string;
};

/**
 * Официальный источник из нашей базы (§29).
 *
 * Модель получает готовый список и выбирает из него. Просить её «найти
 * источник» нельзя: выдуманная ссылка на gov.br — самая убедительная и
 * самая опасная ошибка, которую она может сделать (§30).
 */
export type OfficialSourceOption = {
  organization: string;
  title: string;
  url: string;
};

export type CompanyResponseInput = {
  /// Текст ответа компании — вставленный пользователем или распознанный.
  text: string;
};

export type AiCallMeta = {
  provider: "openai" | "anthropic" | "mock";
  model: string;
  operation: string;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
};

/** Результат плюс метрики вызова — метрики пишутся в AiRequest (§45). */
export type AiResult<T> = {
  data: T;
  meta: AiCallMeta;
};

export interface AIProvider {
  readonly name: "openai" | "anthropic" | "mock";

  classifyCase(context: CaseContext): Promise<AiResult<CaseClassification>>;

  extractDocument(document: DocumentInput): Promise<AiResult<DocumentExtraction>>;

  generateQuestions(context: CaseContext): Promise<AiResult<Questions>>;

  createActionPlan(
    context: CaseContext,
    sources: OfficialSourceOption[],
  ): Promise<AiResult<ActionPlan>>;

  createDraft(context: CaseContext): Promise<AiResult<Draft>>;

  analyzeResponse(
    context: CaseContext,
    response: CompanyResponseInput,
  ): Promise<AiResult<ResponseAnalysis>>;

  summarizeCase(context: CaseContext): Promise<AiResult<CaseSummary>>;

  /** Выбирает подходящие источники из переданных. Своих не добавляет. */
  searchSources(
    query: string,
    category: string | null,
    candidates: OfficialSourceOption[],
  ): Promise<AiResult<SourceSearch>>;
}
