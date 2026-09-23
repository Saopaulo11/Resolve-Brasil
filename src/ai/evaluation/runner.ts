import { AiError } from "../openai/client";
import { checkActionPlan, checkClassification, checkDraft, type Violation } from "./checks";
import type { AIProvider, CaseContext, OfficialSourceOption } from "../providers/AIProvider";
import type { EvalCase } from "./dataset";

/**
 * Прогон набора через провайдера (§81).
 *
 * Меряется три вещи: попадает ли модель в категорию, бывает ли она уверена
 * и при этом неправа, и нарушает ли запреты. Третье — не процент, а брак:
 * одного нарушения достаточно, чтобы прогон считался проваленным.
 */
export type CaseOutcome = {
  id: string;
  expected: string;
  actual: string | null;
  correct: boolean;
  confidence: number | null;
  /** Уверена и неправа — самый дорогой случай: ошибку никто не заметит. */
  confidentlyWrong: boolean;
  violations: Violation[];
  error: string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type EvalReport = {
  provider: string;
  model: string | null;
  startedAt: Date;
  total: number;
  completed: number;
  failed: number;
  correct: number;
  /** null, когда ни одно дело не дошло до ответа: доли от нуля не бывает. */
  accuracy: number | null;
  confidentlyWrong: number;
  violations: Violation[];
  outcomes: CaseOutcome[];
  durationMs: number;
};

export type RunOptions = {
  /** Порог, выше которого ошибка считается «уверенной». */
  confidenceThreshold: number;
  /** Источники, которые разрешено предлагать. Пусто — плана не будет. */
  sources: OfficialSourceOption[];
  /** Проверять ли план и черновик. Втрое дороже, зато ловит выдумки. */
  deep: boolean;
};

export function contextFor(item: EvalCase): CaseContext {
  return {
    publicId: `EVAL-${item.id}`,
    description: item.description,
    category: null,
    subcategory: null,
    companyName: item.companyName,
    amount: item.amount,
    currency: "BRL",
    paymentMethod: item.paymentMethod,
    // Набор оценки ситуацию Pix не описывает: её выбирает живой человек.
    pixSituation: null,
    purchaseDate: null,
    promisedDate: null,
    status: "NOVO",
    confirmedFacts: [],
    timeline: [],
  };
}

function describeError(error: unknown): string {
  if (error instanceof AiError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function runCase(
  provider: AIProvider,
  item: EvalCase,
  options: RunOptions,
): Promise<CaseOutcome> {
  const context = contextFor(item);
  const started = Date.now();

  const base: CaseOutcome = {
    id: item.id,
    expected: item.expectedCategory,
    actual: null,
    correct: false,
    confidence: null,
    confidentlyWrong: false,
    violations: [],
    error: null,
    latencyMs: 0,
    inputTokens: null,
    outputTokens: null,
  };

  try {
    const classification = await provider.classifyCase(context);
    const correct = classification.data.category === item.expectedCategory;

    const violations = checkClassification(classification.data);

    if (options.deep) {
      const plan = await provider.createActionPlan(context, options.sources);
      violations.push(...checkActionPlan(plan.data));

      const draft = await provider.createDraft(context);
      violations.push(...checkDraft(draft.data, item.description));
    }

    return {
      ...base,
      actual: classification.data.category,
      correct,
      confidence: classification.data.confidence,
      confidentlyWrong: !correct && classification.data.confidence >= options.confidenceThreshold,
      violations,
      latencyMs: Date.now() - started,
      inputTokens: classification.meta.inputTokens,
      outputTokens: classification.meta.outputTokens,
    };
  } catch (error) {
    // Сбой — это результат прогона, а не повод его прервать: остальные дела
    // всё равно нужно измерить.
    return { ...base, error: describeError(error), latencyMs: Date.now() - started };
  }
}

export async function runEvaluation(
  provider: AIProvider,
  cases: readonly EvalCase[],
  options: RunOptions,
  model: string | null = null,
): Promise<EvalReport> {
  const startedAt = new Date();
  const outcomes: CaseOutcome[] = [];

  // Последовательно: параллельный прогон упирается в лимит провайдера и
  // портит измерение задержки, ради которого всё и делается.
  for (const item of cases) {
    outcomes.push(await runCase(provider, item, options));
  }

  const completed = outcomes.filter((outcome) => outcome.error === null);
  const correct = completed.filter((outcome) => outcome.correct).length;

  return {
    provider: provider.name,
    model,
    startedAt,
    total: outcomes.length,
    completed: completed.length,
    failed: outcomes.length - completed.length,
    correct,
    accuracy: completed.length === 0 ? null : correct / completed.length,
    confidentlyWrong: completed.filter((outcome) => outcome.confidentlyWrong).length,
    violations: outcomes.flatMap((outcome) => outcome.violations),
    outcomes,
    durationMs: Date.now() - startedAt.getTime(),
  };
}

/**
 * Прошёл ли прогон.
 *
 * Нарушение запрета проваливает прогон при любой точности: ответ, который
 * обещает результат или ссылается на выдуманный закон, — брак, а не
 * статистика.
 */
export function evaluationPassed(
  report: EvalReport,
  minAccuracy: number,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (report.violations.length > 0) {
    reasons.push(`нарушений запретов: ${report.violations.length}`);
  }
  if (report.failed > 0) {
    reasons.push(`дел без ответа: ${report.failed}`);
  }
  if (report.accuracy === null) {
    reasons.push("ни одно дело не дошло до ответа");
  } else if (report.accuracy < minAccuracy) {
    reasons.push(
      `точность ${(report.accuracy * 100).toFixed(1)}% ниже порога ${(minAccuracy * 100).toFixed(1)}%`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
