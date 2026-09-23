import type { PaymentMethod } from "../generated/prisma/enums";

/**
 * Превращение подтверждённых фактов в поля дела (§26).
 *
 * Сюда попадает только то, что человек подтвердил или исправил сам. Догадка
 * модели полем дела не становится: в поле она выглядит ровно как факт, и
 * отличить их потом будет нечем (§5).
 *
 * Разбор бразильских форматов вынесен сюда целиком. Он обязан уметь
 * отказываться: непонятное значение остаётся в списке фактов как есть и в
 * поле не попадает. Наполовину разобранная сумма хуже пустого поля.
 */

/**
 * Сумма. «R$ 1.299,00» — точка разделяет тысячи, запятая отделяет центы.
 *
 * Возвращается строкой: число с плавающей точкой теряет копейки, а спор
 * идёт именно о них.
 */
export function parseAmount(raw: string): string | null {
  // Минус перед числом — мусор в сумме покупки. Отбросить его молча значило
  // бы превратить «-50» в «50»: тихое исправление чужих данных.
  if (/-\s*\d/.test(raw)) return null;

  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (cleaned.length === 0) return null;

  let normalized: string;

  if (cleaned.includes(",")) {
    // Запятая есть — она десятичная, точки убираем как разделители тысяч.
    const parts = cleaned.split(",");
    if (parts.length > 2) return null;
    normalized = `${parts[0]?.replace(/\./g, "") ?? ""}.${parts[1] ?? ""}`;
  } else {
    const dots = cleaned.split(".");
    if (dots.length === 1) {
      normalized = cleaned;
    } else {
      const last = dots[dots.length - 1] ?? "";
      // Три цифры после последней точки — это тысячи: «1.299» = 1299.
      normalized =
        last.length === 3 ? dots.join("") : `${dots.slice(0, -1).join("")}.${last}`;
    }
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);
  // Отрицательных и абсурдных сумм в потребительском деле не бывает, а
  // разобранная неверно цифра уедет в аналитику как настоящая.
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) return null;

  return value.toFixed(2);
}

/** Дата. Бразильский порядок — день, месяц, год. */
export function parseDate(raw: string): Date | null {
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);

  let year: number;
  let month: number;
  let day: number;

  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (br) {
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
    // Двузначный год: «24» — это 2024, а не 1924.
    if (year < 100) year += 2000;
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // 31 февраля превращается в 3 марта — такую дату принимать нельзя.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date;
}

const PAYMENT_MARKERS: ReadonlyArray<{ method: PaymentMethod; markers: readonly string[] }> = [
  { method: "PIX", markers: ["pix"] },
  {
    method: "CARTAO_CREDITO",
    markers: ["cartao de credito", "cartao credito", "credito", "credit"],
  },
  {
    method: "CARTAO_DEBITO",
    markers: ["cartao de debito", "cartao debito", "debito", "debit"],
  },
  { method: "BOLETO", markers: ["boleto"] },
  { method: "TRANSFERENCIA", markers: ["transferencia", "ted", "doc"] },
  { method: "DINHEIRO", markers: ["dinheiro", "especie"] },
];

/** Способ оплаты. Непонятное значение остаётся DESCONHECIDO, а не OUTRO. */
export function parsePaymentMethod(raw: string): PaymentMethod | null {
  const text = raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  if (text.length === 0) return null;

  for (const rule of PAYMENT_MARKERS) {
    for (const marker of rule.markers) {
      if (` ${text} `.includes(` ${marker} `)) return rule.method;
    }
  }

  return null;
}

/** Поля дела, которые можно вывести из подтверждённых фактов. */
export type CaseFieldUpdate = {
  companyName?: string;
  amount?: string;
  paymentMethod?: PaymentMethod;
  purchaseDate?: Date;
  promisedDate?: Date;
};

/**
 * Собирает изменение полей дела из подтверждённых фактов.
 *
 * Поле, которое не удалось разобрать, просто не появляется в результате:
 * факт остаётся в списке, человек его видит, а в дело неразобранное
 * значение не попадает.
 */
export function fieldsFromFacts(
  facts: ReadonlyArray<{ field: string; value: string }>,
): CaseFieldUpdate {
  const update: CaseFieldUpdate = {};
  const byField = new Map(facts.map((fact) => [fact.field, fact.value]));

  const company = byField.get("company")?.trim();
  if (company && company.length >= 2 && company.length <= 200) {
    update.companyName = company;
  }

  const amount = byField.get("amount");
  if (amount) {
    const parsed = parseAmount(amount);
    if (parsed) update.amount = parsed;
  }

  const payment = byField.get("payment_method");
  if (payment) {
    const parsed = parsePaymentMethod(payment);
    if (parsed) update.paymentMethod = parsed;
  }

  const purchase = byField.get("purchase_date");
  if (purchase) {
    const parsed = parseDate(purchase);
    if (parsed) update.purchaseDate = parsed;
  }

  const promised = byField.get("promised_delivery_date");
  if (promised) {
    const parsed = parseDate(promised);
    if (parsed) update.promisedDate = parsed;
  }

  return update;
}

export { PAYMENT_MARKERS };
