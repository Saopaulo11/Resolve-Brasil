import type { CaseCategory } from "../generated/prisma/enums";
import { trackEvent } from "../analytics/events";
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
  return cases.findByPublicId(publicId);
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
