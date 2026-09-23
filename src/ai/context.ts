import type { CaseEventRecord, CaseRecord } from "../cases/caseStore";
import type { CaseContext } from "./providers/AIProvider";

/**
 * Сборка выборки данных для модели (§47, §48).
 *
 * Это единственное место, где данные дела превращаются в то, что уходит
 * наружу. Сюда намеренно не попадают телефон, email, CPF, адрес,
 * идентификатор транзакции Pix, сырые документы и записи о сессиях — ни
 * одно из этого модели для работы не нужно.
 *
 * Тип CaseContext служит границей: добавить в отправку новое поле нельзя,
 * не изменив контракт осознанно.
 */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function buildCaseContext(input: {
  case: CaseRecord;
  timeline: CaseEventRecord[];
  confirmedFacts?: Array<{ field: string; value: string }>;
}): CaseContext {
  return {
    publicId: input.case.publicId,
    description: input.case.description,
    category: input.case.category,
    subcategory: input.case.subcategory,
    companyName: input.case.companyName,
    amount: input.case.amount,
    currency: input.case.currency,
    paymentMethod: input.case.paymentMethod,
    pixSituation: input.case.pixSituation,
    purchaseDate: isoDate(input.case.purchaseDate),
    promisedDate: isoDate(input.case.promisedDate),
    status: input.case.status,
    // Только подтверждённые факты: догадка, поданная модели как факт,
    // вернётся от неё уже в виде вывода (§5, §26).
    confirmedFacts: input.confirmedFacts ?? [],
    timeline: input.timeline.map((event) => ({
      date: isoDate(event.eventDate) ?? "",
      title: event.title,
    })),
  };
}
