/**
 * Нормализация названия компании (§85).
 *
 * «Loja Exemplo S.A.», «LOJA EXEMPLO LTDA» и «loja exemplo» — одна компания.
 * Без приведения к общему виду срез по компании считает их тремя разными, и
 * каждая группа оказывается меньше порога подавления: данные есть, а
 * показать нечего.
 *
 * Правила простые намеренно. Умное сопоставление («magalu» ≈ «Magazine
 * Luiza») требует справочника настоящих компаний, а его у нас нет и
 * выдумывать нельзя (§82). Такие соответствия заводит человек — через
 * алиасы с пометкой «проверено».
 */

/**
 * Организационно-правовые формы и обычные хвосты названий.
 *
 * Убираются только целыми словами: «sal» не должно превратиться в «s» из-за
 * того, что «sa» встретилось внутри.
 */
const LEGAL_FORMS = [
  "sa",
  "s a",
  "ltda",
  "limitada",
  "eireli",
  "me",
  "epp",
  "mei",
  "cia",
  "companhia",
  "industria",
  "comercio",
  "comercial",
  "servicos",
  "participacoes",
  "holding",
  "group",
  "grupo",
  "do brasil",
  "brasil",
  "br",
];

/** Убирает диакритику: «serviços» и «servicos» — одно слово. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "");
}

export function normalizeCompanyName(raw: string): string {
  let text = stripDiacritics(raw)
    .toLowerCase()
    // «s.a.» → «s a», «&» → пробел: пунктуация в названии ничего не значит.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  // Хвосты снимаются по одному с конца: «exemplo comercio ltda» →
  // «exemplo comercio» → «exemplo». Изнутри названия ничего не вырезается —
  // «Comercio Exemplo» обязано остаться «comercio exemplo».
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of LEGAL_FORMS) {
      const suffix = ` ${form}`;
      if (text.endsWith(suffix) && text.length > suffix.length) {
        text = text.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
  }

  return text.replace(/\s+/g, " ").trim();
}

/**
 * Годится ли строка как название компании.
 *
 * Пустое и односимвольное отбрасывается: такой «компанией» склеятся дела,
 * не имеющие друг к другу отношения.
 */
export function isUsableCompanyName(raw: string): boolean {
  const normalized = normalizeCompanyName(raw);
  return normalized.length >= 2 && normalized.length <= 200;
}

export { LEGAL_FORMS };
