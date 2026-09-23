import { createHash } from "node:crypto";

import type { CaseRecord } from "../cases/caseStore";
import type {
  CaseCategory,
  CaseStatus,
  EscalationLevel,
  Industry,
  PixSituation,
  PaymentMethod,
} from "../generated/prisma/enums";
import { amountBucket } from "./events";

/**
 * Превращение дела в обезличенный слепок (§54, §56).
 *
 * Это и есть шаг «Privacy Processing» конвейера. Функция чистая и не ходит
 * в базу: её задача — доказуемо не пропустить наружу ничего, что ведёт к
 * человеку.
 *
 * Сюда НЕ попадают и попасть не могут: телефон, email, CPF, имя, адрес,
 * текст обращения, переписка, документы, идентификатор транзакции Pix.
 * Точная сумма заменяется диапазоном, точная дата — месяцем: вместе с
 * городом и категорией они опознают человека не хуже имени.
 */
export type AnalyticsProjection = {
  caseKey: string;
  month: string;
  state: string | null;
  cityBucket: string | null;
  category: CaseCategory;
  subcategory: string | null;
  industry: Industry;
  companyNormalized: string | null;
  amountBucket: string | null;
  paymentMethod: PaymentMethod;
  pixSituation: PixSituation | null;
  resolutionStatus: CaseStatus;
  resolutionDays: number | null;
  escalationLevel: EscalationLevel;
  confidence: number | null;
  isDemo: boolean;
};

/**
 * Псевдоним дела. Соль — серверный секрет: без неё хеш от идентификатора
 * перебирается, а выгрузка аналитики секрета не содержит.
 */
export function caseKey(caseId: string, secret: string): string {
  return createHash("sha256").update(`case:${secret}:${caseId}`).digest("hex").slice(0, 32);
}

/** Месяц вместо даты: YYYY-MM. */
function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Целые дни между созданием и закрытием. Незакрытое дело — null. */
function resolutionDays(caseRecord: CaseRecord): number | null {
  if (!caseRecord.closedAt) return null;
  const ms = caseRecord.closedAt.getTime() - caseRecord.createdAt.getTime();
  if (ms < 0) return null;
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function projectCase(input: {
  caseRecord: CaseRecord;
  industry: Industry;
  secret: string;
  confidence: number | null;
  isDemo: boolean;
}): AnalyticsProjection {
  const { caseRecord } = input;

  return {
    caseKey: caseKey(caseRecord.id, input.secret),
    month: monthOf(caseRecord.createdAt),
    state: caseRecord.state,
    cityBucket: caseRecord.cityBucket,
    // Неклассифицированное дело попадает в OUTRO, а не выдумывает категорию.
    category: caseRecord.category ?? "OUTRO",
    subcategory: caseRecord.subcategory,
    industry: input.industry,
    companyNormalized: caseRecord.companyNormalized,
    amountBucket: amountBucket(caseRecord.amount === null ? null : Number(caseRecord.amount)),
    paymentMethod: caseRecord.paymentMethod,
    pixSituation: caseRecord.pixSituation,
    resolutionStatus: caseRecord.status,
    resolutionDays: resolutionDays(caseRecord),
    escalationLevel: caseRecord.escalationLevel,
    confidence: input.confidence,
    isDemo: input.isDemo,
  };
}

/**
 * Поля, которых в слепке быть не может (§56).
 *
 * Список нужен тесту: он сверяет, что ни одно из них не просочилось при
 * очередной правке проекции.
 */
export const FORBIDDEN_FIELDS = [
  "phone",
  "email",
  "cpf",
  "name",
  "displayName",
  "address",
  "description",
  "userId",
  "publicId",
  "id",
  "pixId",
  "transactionId",
] as const;

export { monthOf, resolutionDays };
