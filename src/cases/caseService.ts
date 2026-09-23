import type { CaseCategory, PixSituation } from "../generated/prisma/enums";
import { trackEvent } from "../analytics/events";
import { refreshProjection } from "../analytics/pipeline";
import { generatePublicCaseId } from "../utils/ids";
import { stores } from "../users/storeRegistry";
import type { CaseEventRecord, CaseRecord } from "./caseStore";

/**
 * Дела (§21, §22).
 *
 * Состояние дела живёт в нашей базе, а не у AI-провайдера (§91, §92).
 */

/**
 * Сколько раз пробовать новый публичный идентификатор при совпадении.
 *
 * Совпадение практически невероятно (31^6 вариантов), но молча отдать
 * пользователю чужой номер дела нельзя ни при какой вероятности.
 */
const PUBLIC_ID_ATTEMPTS = 5;

async function allocatePublicId(): Promise<string> {
  const { cases } = stores();

  for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt += 1) {
    const candidate = generatePublicCaseId();
    if (!(await cases.publicIdExists(candidate))) return candidate;
  }

  throw new Error("Не удалось подобрать свободный публичный номер дела.");
}

export async function createCase(input: {
  userId: string | null;
  description: string;
  category: CaseCategory | null;
}): Promise<CaseRecord> {
  const { cases } = stores();

  const created = await cases.create({
    publicId: await allocatePublicId(),
    userId: input.userId,
    description: input.description,
    category: input.category,
  });

  // Первое событие хронологии — сам факт обращения. Источник USER_FACT:
  // это рассказ пользователя, а не вывод модели (§5).
  await cases.addEvent({
    caseId: created.id,
    type: "caso_criado",
    title: "Caso registrado",
    description: null,
    eventDate: created.createdAt,
    source: "USER_FACT",
  });

  // Consumer Intelligence закладывается с первого дела (§53), но остаётся
  // невидимым для пользователя и не содержит ничего, ведущего к нему.
  await refreshProjection(created);

  void trackEvent("case_created", { userId: input.userId });
  if (input.category) {
    void trackEvent("case_category_created", {
      userId: input.userId,
      properties: { category: input.category },
    });
  }

  return created;
}

/**
 * Привязать дело, созданное до входа, к вошедшему пользователю.
 *
 * Уже привязанное дело не перехватывается: проверка идёт и здесь, и в
 * условии запроса к хранилищу — чужой номер дела в куке не должен давать
 * к нему доступ.
 */
export async function attachCaseToUser(
  publicId: string,
  userId: string,
): Promise<CaseRecord | null> {
  const { cases } = stores();

  const found = await cases.findByPublicId(publicId);
  if (!found) return null;
  if (found.userId !== null) return found.userId === userId ? found : null;

  await cases.attachToUser(found.id, userId);

  const attached = await cases.findByPublicId(publicId);
  // Владелец сменился — слепок пересчитывается: от него зависит признак
  // демонстрационного дела.
  if (attached) await refreshProjection(attached);
  return attached;
}

export async function listCases(userId: string): Promise<CaseRecord[]> {
  return stores().cases.listForUser(userId);
}

export type CaseWithTimeline = {
  case: CaseRecord;
  timeline: CaseEventRecord[];
};

/**
 * Дело конкретного пользователя.
 *
 * Чужое дело и несуществующее дело неотличимы снаружи — оба дают null и
 * приводят к 404. Ответ «403» подтвердил бы, что такой номер существует, и
 * публичные номера превратились бы в способ проверять их наличие перебором.
 */
export async function getCaseForUser(
  publicId: string,
  userId: string,
): Promise<CaseWithTimeline | null> {
  const { cases } = stores();

  const found = await cases.findByPublicId(publicId);
  if (!found) return null;
  if (found.userId !== userId) return null;

  return { case: found, timeline: await cases.listEvents(found.id) };
}

/**
 * Ситуация с Pix (§36).
 *
 * Выбирает человек. Отличить мошенничество от коммерческого спора по
 * рассказу нельзя, а ошибка здесь уводит дело совсем не туда — поэтому
 * система не догадывается, а спрашивает (§5).
 */
export async function setPixSituation(input: {
  caseRecord: CaseRecord;
  situation: PixSituation;
  label: string;
}): Promise<CaseRecord | null> {
  const { cases } = stores();

  // Вопрос имеет смысл только там, где платили через Pix. В остальных
  // случаях это поле осталось бы непроверяемым мусором в аналитике.
  if (input.caseRecord.paymentMethod !== "PIX") return null;
  if (input.caseRecord.pixSituation === input.situation) return input.caseRecord;

  await cases.setPixSituation(input.caseRecord.id, input.situation);

  await cases.addEvent({
    caseId: input.caseRecord.id,
    type: "pix_situacao",
    title: `Situação do Pix: ${input.label}`,
    description: null,
    eventDate: new Date(),
    source: "USER_FACT",
  });

  const updated = await cases.findById(input.caseRecord.id);
  if (updated) await refreshProjection(updated);

  return updated;
}

// --- Завершение и эскалация -------------------------------------------------

/**
 * Исход дела словами пользователя (§19).
 *
 * Два исхода, и оба честные. «Resolvido» — проблема решена. «Encerrado» —
 * человек прекращает вести дело, решения не случилось. Сводить их к одному
 * нельзя: иначе в отчёте каждое брошенное дело будет выглядеть успехом.
 */
export type CaseOutcome = "resolvido" | "encerrado";

const OUTCOME_STATUS = {
  resolvido: "RESOLVIDO",
  encerrado: "ENCERRADO",
} as const;

const OUTCOME_TITLE = {
  resolvido: "Caso marcado como resolvido",
  encerrado: "Caso encerrado sem solução",
} as const;

export function isClosedStatus(status: CaseRecord["status"]): boolean {
  return status === "RESOLVIDO" || status === "ENCERRADO";
}

/**
 * Закрыть дело.
 *
 * Отмечает сам человек, а не мы: у нас нет способа узнать, вернулись ли
 * деньги. Поэтому это USER_FACT, а не вывод (§5).
 *
 * Вместе со статусом ставится дата закрытия. Без неё срок хранения (§65)
 * не наступает никогда — закрытое дело остаётся в базе навсегда, — а
 * медиана времени до решения не считается вовсе.
 */
export async function closeCase(input: {
  caseRecord: CaseRecord;
  outcome: CaseOutcome;
}): Promise<CaseRecord | null> {
  const { cases } = stores();
  if (isClosedStatus(input.caseRecord.status)) return null;

  const now = new Date();
  await cases.close(input.caseRecord.id, OUTCOME_STATUS[input.outcome], now);

  await cases.addEvent({
    caseId: input.caseRecord.id,
    type: "caso_encerrado",
    title: OUTCOME_TITLE[input.outcome],
    description: null,
    eventDate: now,
    source: "USER_FACT",
  });

  const updated = await cases.findById(input.caseRecord.id);
  if (updated) await refreshProjection(updated);

  void trackEvent(
    input.outcome === "resolvido" ? "case_resolved" : "resolution_status_changed",
    { userId: input.caseRecord.userId },
  );

  return updated;
}

/** Вернуть дело в работу: закрыл по ошибке или проблема вернулась. */
export async function reopenCase(caseRecord: CaseRecord): Promise<CaseRecord | null> {
  const { cases } = stores();
  if (!isClosedStatus(caseRecord.status)) return null;

  await cases.reopen(caseRecord.id, "PRECISA_DE_ACAO");

  await cases.addEvent({
    caseId: caseRecord.id,
    type: "caso_reaberto",
    title: "Caso reaberto",
    description: null,
    eventDate: new Date(),
    source: "USER_FACT",
  });

  const updated = await cases.findById(caseRecord.id);
  if (updated) await refreshProjection(updated);

  void trackEvent("resolution_status_changed", { userId: caseRecord.userId });
  return updated;
}

/**
 * Порядок каналов (§33, §36).
 *
 * Это обычная последовательность, а не обязательная процедура: человек
 * вправе пойти сразу в Procon, и мы это запишем. Порядок нужен только
 * чтобы подсказать следующий шаг, а не чтобы запретить остальные.
 */
export const ESCALATION_ORDER = [
  "NENHUM",
  "EMPRESA",
  "SAC",
  "OUVIDORIA",
  "CONSUMIDOR_GOV",
  "ORGAO_COMPETENTE",
] as const;

export type EscalationStep = (typeof ESCALATION_ORDER)[number];

export function nextEscalation(current: EscalationStep): EscalationStep | null {
  const index = ESCALATION_ORDER.indexOf(current);
  if (index < 0 || index >= ESCALATION_ORDER.length - 1) return null;
  return ESCALATION_ORDER[index + 1] ?? null;
}

/**
 * Отметить, что дело ушло на другой канал.
 *
 * Обращается человек — мы не подаём жалобу за него и не представляем его
 * (§3). Здесь только запись того, что он сделал сам.
 */
export async function escalateCase(input: {
  caseRecord: CaseRecord;
  level: EscalationStep;
  label: string;
}): Promise<CaseRecord | null> {
  const { cases } = stores();
  if (input.level === "NENHUM") return null;
  if (isClosedStatus(input.caseRecord.status)) return null;

  await cases.setEscalation(input.caseRecord.id, input.level, "ESCALADO");

  await cases.addEvent({
    caseId: input.caseRecord.id,
    type: "caso_escalado",
    title: `Caso levado para: ${input.label}`,
    description: null,
    eventDate: new Date(),
    source: "USER_FACT",
  });

  const updated = await cases.findById(input.caseRecord.id);
  if (updated) await refreshProjection(updated);

  void trackEvent("case_escalated", { userId: input.caseRecord.userId });
  return updated;
}
