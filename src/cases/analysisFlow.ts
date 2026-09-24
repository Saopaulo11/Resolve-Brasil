import type { AnalysisKind } from "./analysisService";
import type { MessageType } from "../generated/prisma/enums";

/**
 * Порядок разбора дела (§3, §5).
 *
 * Главная обещает три шага: «IA organiza o caso» — понимает ситуацию,
 * спрашивает, чего не хватает, и выдаёт план действий вместе с готовым
 * сообщением компании. До сих пор это обещание человек выполнял сам: на
 * странице дела стояли четыре кнопки, и их нужно было нажать по очереди, в
 * правильном порядке, догадавшись, что порядок вообще есть.
 *
 * Здесь порядок записан один раз. Страница дела идёт по нему сама, шаг за
 * шаг, и человек видит, как дело собирается, а не набор рычагов.
 *
 * Почему по одному шагу на запрос: каждый шаг — обращение к модели, и все
 * четыре подряд не укладываются в срок одного вызова бессерверной функции.
 * Оборванный на середине запрос оставил бы дело без части разбора и без
 * объяснения.
 */
export const ANALYSIS_ORDER: readonly AnalysisKind[] = [
  "classificar",
  "perguntas",
  "plano",
  "rascunho",
] as const;

const MESSAGE_TYPE: Record<AnalysisKind, MessageType> = {
  classificar: "CLASSIFICACAO",
  perguntas: "PERGUNTAS",
  plano: "PLANO_DE_ACAO",
  rascunho: "RASCUNHO",
};

/** Что сейчас происходит — словами, которые человек ждёт увидеть. */
export const STEP_LABEL: Record<AnalysisKind, string> = {
  classificar: "Entendendo sua situação",
  perguntas: "Vendo o que ainda falta",
  plano: "Montando seu plano de ação",
  rascunho: "Escrevendo a mensagem para a empresa",
};

export type AnalysisProgress = {
  /** Следующий невыполненный шаг или null, когда разбор закончен. */
  next: AnalysisKind | null;
  /** Сколько шагов уже есть. */
  done: number;
  /** Сколько всего. */
  total: number;
  label: string | null;
};

/**
 * Где сейчас дело.
 *
 * Считается по уже сохранённым сообщениям, а не по отдельному полю статуса:
 * поле пришлось бы держать в согласии с сообщениями, и они разошлись бы при
 * первом же обрыве. Сообщение есть — шаг сделан.
 */
export function analysisProgress(
  messageTypes: readonly string[],
): AnalysisProgress {
  const presentes = new Set(messageTypes);

  const pendentes = ANALYSIS_ORDER.filter(
    (kind) => !presentes.has(MESSAGE_TYPE[kind]),
  );

  const next = pendentes[0] ?? null;

  return {
    next,
    done: ANALYSIS_ORDER.length - pendentes.length,
    total: ANALYSIS_ORDER.length,
    label: next ? STEP_LABEL[next] : null,
  };
}
