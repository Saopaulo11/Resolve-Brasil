import type { ActionPlan, CaseClassification, Draft } from "../schemas";
import { isOfficialSourceUrl } from "../../sources/policy";

/**
 * Инварианты ответа модели (§81).
 *
 * Это не тест на «хороший ответ» — вкус измерять нечем. Это проверка того,
 * чего в ответе быть не должно ни при каких обстоятельствах: обещания
 * результата, роли адвоката, номера закона без источника, ссылки на
 * неофициальный сайт, номера протокола, которого человек не называл.
 *
 * Такое нарушение — не процент качества, а брак: одно достаточно, чтобы
 * ответ не показывать.
 */
export type ViolationKind =
  | "garantia_de_resultado"
  | "papel_de_advogado"
  | "citacao_legal_sem_fonte"
  | "fonte_fora_da_lista"
  | "numero_inventado"
  | "texto_por_preencher";

export type Violation = {
  kind: ViolationKind;
  /** Фрагмент, на котором сработала проверка. Для отчёта, не для показа. */
  evidence: string;
  where: string;
};

export const VIOLATION_LABELS: Record<ViolationKind, string> = {
  garantia_de_resultado: "обещание результата",
  papel_de_advogado: "роль адвоката или представителя",
  citacao_legal_sem_fonte: "ссылка на закон без официального источника",
  fonte_fora_da_lista: "адрес вне списка официальных доменов",
  numero_inventado: "номер, которого не было в деле",
  texto_por_preencher: "незаполненный шаблон в готовом тексте",
};

/**
 * Границы слова для португальского.
 *
 * `\b` в JavaScript считает буквами только ASCII, поэтому «você» и
 * «receberá» ломают его молча: выражение просто перестаёт срабатывать, а
 * выглядит рабочим. Здесь граница задана через классы Unicode.
 */
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";

function phrase(body: string): RegExp {
  return new RegExp(`${START}(?:${body})${END}`, "iu");
}

/**
 * Обещания результата (§3).
 *
 * Слова «garantia» здесь намеренно нет: гарантия на товар — обычное и
 * законное понятие бразильского потребительского права, и запрет на него
 * ломал бы правильные ответы. Ищется обещание от нашего лица и
 * утверждение об исходе.
 */
const GUARANTEE_PATTERNS: readonly RegExp[] = [
  phrase("garant(?:imos|o|iremos)"),
  phrase("(?:é|está|fica)\\s+garantid[oa]"),
  phrase("assegur(?:amos|o)"),
  phrase("promet(?:emos|o)"),
  phrase("podemos\\s+garantir"),
  phrase("com\\s+certeza\\s+(?:você|o\\s+senhor|a\\s+senhora)"),
  phrase("certamente\\s+(?:você|receberá|vai|irá)"),
  phrase("sem\\s+d[úu]vida\\s+(?:você|vai|irá)"),
  phrase("100\\s*%\\s+de\\s+(?:chance|sucesso|certeza)"),
  phrase("n[ãa]o\\s+h[áa]\\s+risco"),
  phrase("resultado\\s+garantid[oa]"),
];

/** Роль, которой у нас нет (§3). */
const LAWYER_PATTERNS: readonly RegExp[] = [
  phrase("nossos?\\s+advogados?"),
  phrase("somos\\s+(?:advogados|um\\s+escrit[óo]rio)"),
  phrase("(?:vamos|iremos)\\s+process(?:ar|aremos)"),
  phrase("entrar(?:emos)?\\s+com\\s+(?:uma\\s+)?a[çc][ãa]o"),
  phrase("representamos\\s+(?:voc[êe]|o\\s+senhor|a\\s+senhora)"),
  phrase("em\\s+(?:seu|teu)\\s+nome"),
  phrase("(?:vamos|iremos)\\s+(?:entrar\\s+em\\s+contato|falar)\\s+com\\s+a\\s+empresa"),
  phrase("nossa\\s+equipe\\s+jur[íi]dica"),
];

/** Ссылка на конкретную норму. Без официального источника — выдумка (§9). */
const LEGAL_CITATION = /\b(?:art(?:igo)?\.?\s*\d+|lei\s*n?[º°.]?\s*\d|decreto\s*n?[º°.]?\s*\d|s[úu]mula\s*\d|§\s*\d)/i;

/** Незаполненный шаблон в тексте, который человеку предлагают отправить. */
const PLACEHOLDER = /(\[[^\]]{2,60}\]|\bXXX+\b|\{\{[^}]+\}\}|_{4,})/;

/** Любой адрес в свободном тексте — его никто не валидировал схемой. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"')]+/gi;

function scan(
  text: string | null | undefined,
  where: string,
  patterns: readonly RegExp[],
  kind: ViolationKind,
): Violation[] {
  if (!text) return [];
  const found: Violation[] = [];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) found.push({ kind, evidence: match[0], where });
  }
  return found;
}

/** Обещания и роли — в любом тексте, который увидит человек. */
export function checkText(text: string | null | undefined, where: string): Violation[] {
  return [
    ...scan(text, where, GUARANTEE_PATTERNS, "garantia_de_resultado"),
    ...scan(text, where, LAWYER_PATTERNS, "papel_de_advogado"),
    ...checkUrls(text, where),
  ];
}

function checkUrls(text: string | null | undefined, where: string): Violation[] {
  if (!text) return [];
  const found: Violation[] = [];
  for (const url of text.match(URL_IN_TEXT) ?? []) {
    // Хвостовая пунктуация прилипает к адресу в обычном тексте.
    const cleaned = url.replace(/[.,;:)\]]+$/, "");
    if (!isOfficialSourceUrl(cleaned)) {
      found.push({ kind: "fonte_fora_da_lista", evidence: cleaned, where });
    }
  }
  return found;
}

export function checkClassification(result: CaseClassification): Violation[] {
  return [
    ...result.missing_information.flatMap((item, i) =>
      checkText(item, `classificacao.missing_information[${i}]`),
    ),
    ...result.recommended_questions.flatMap((item, i) =>
      checkText(item, `classificacao.recommended_questions[${i}]`),
    ),
    ...result.risk_flags.flatMap((item, i) => checkText(item, `classificacao.risk_flags[${i}]`)),
  ];
}

export function checkActionPlan(plan: ActionPlan): Violation[] {
  const found: Violation[] = [];

  for (const [i, step] of plan.steps.entries()) {
    const where = `plano.steps[${i}]`;
    found.push(...checkText(step.title, where), ...checkText(step.detail, where));

    // Норма закона имеет право появиться только в шаге, который опирается
    // на проверенный источник. Иначе это номер, взятый из ниоткуда.
    const citation = LEGAL_CITATION.exec(`${step.title} ${step.detail}`);
    if (citation && (step.source !== "OFFICIAL_SOURCE" || plan.sources.length === 0)) {
      found.push({ kind: "citacao_legal_sem_fonte", evidence: citation[0], where });
    }
  }

  for (const [i, source] of plan.sources.entries()) {
    if (!isOfficialSourceUrl(source.url)) {
      found.push({
        kind: "fonte_fora_da_lista",
        evidence: source.url,
        where: `plano.sources[${i}]`,
      });
    }
  }

  found.push(
    ...plan.uncertainties.flatMap((item, i) => checkText(item, `plano.uncertainties[${i}]`)),
  );

  return found;
}

/**
 * Даты. Убираются до поиска номеров: «10/09/2026» — это не протокол, а
 * дата, и принять её за выдуманный номер значит завалить проверку шумом.
 */
const DATE_LIKE = /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}/g;

/**
 * Длинные числа: протоколы, номера заказов, документы.
 *
 * Разделители внутри допускаются — «8845-1236-0077» и «884512360077» это
 * один номер, и переформатирование не выдумка. Порог в шесть цифр
 * отсекает суммы и годы.
 */
function longNumbers(text: string): string[] {
  return (text.replace(DATE_LIKE, " ").match(/\d[\d.\-/]*\d/g) ?? [])
    .map((match) => match.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 6);
}

/**
 * Черновик письма (§9, §34).
 *
 * Номер протокола, которого человек не называл, — самая дорогая выдумка из
 * возможных: письмо с ним компания отклонит, а человек решит, что ошибся он.
 */
export function checkDraft(draft: Draft, contextText: string): Violation[] {
  const found: Violation[] = [
    ...checkText(draft.subject, "rascunho.subject"),
    ...checkText(draft.body, "rascunho.body"),
    ...draft.warnings.flatMap((item, i) => checkText(item, `rascunho.warnings[${i}]`)),
  ];

  const known = new Set(longNumbers(contextText));
  for (const number of longNumbers(draft.body)) {
    if (!known.has(number)) {
      found.push({ kind: "numero_inventado", evidence: number, where: "rascunho.body" });
    }
  }

  const placeholder = PLACEHOLDER.exec(draft.body);
  if (placeholder) {
    found.push({
      kind: "texto_por_preencher",
      evidence: placeholder[0],
      where: "rascunho.body",
    });
  }

  return found;
}

export { GUARANTEE_PATTERNS, LAWYER_PATTERNS, LEGAL_CITATION };
