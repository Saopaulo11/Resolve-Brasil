import { db } from "../services/db";

/**
 * Официальные источники (§29–§32).
 *
 * Главное свойство: источник, который никем не проверен, не существует для
 * системы. Он не показывается пользователю и не попадает в запрос к модели.
 * Непроверенная ссылка на gov.br опаснее отсутствия ссылки — она выглядит
 * как подтверждение.
 */
export type SourceRecord = {
  id: string;
  organization: string;
  title: string;
  url: string;
  category: string | null;
  content: string | null;
  lastVerifiedAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertSourceInput = {
  organization: string;
  title: string;
  url: string;
  category: string | null;
};

export interface SourceStore {
  /** Добавляет источник, если его ещё нет. Проверку не выставляет. */
  upsert(input: UpsertSourceInput): Promise<SourceRecord>;
  listAll(): Promise<SourceRecord[]>;
  /** Проверенные и не устаревшие — только они идут в дело. */
  listUsable(verifiedAfter: Date, limit: number): Promise<SourceRecord[]>;
  findByUrl(url: string): Promise<SourceRecord | null>;
  markVerified(sourceId: string, at: Date): Promise<void>;
  markUnavailable(sourceId: string, reason: string): Promise<void>;
  /**
   * Запоминает, на какой источник опирается утверждение в деле (§31).
   *
   * Без этой связи нельзя ответить на вопрос «откуда это взялось»: план
   * показывает ссылки, а через месяц непонятно, какой именно шаг на
   * какую из них опирался.
   */
  linkToCase(input: { caseId: string; sourceId: string; claim: string }): Promise<void>;
  listForCase(caseId: string): Promise<Array<{ claim: string; source: SourceRecord }>>;
}

export class PrismaSourceStore implements SourceStore {
  async upsert(input: UpsertSourceInput): Promise<SourceRecord> {
    return db().officialSource.upsert({
      where: { url: input.url },
      // Существующий источник не трогаем: перезапись сбросила бы
      // подтверждение, поставленное настоящей проверкой.
      update: {},
      create: {
        organization: input.organization,
        title: input.title,
        url: input.url,
        category: input.category,
        active: false,
      },
    });
  }

  async listAll(): Promise<SourceRecord[]> {
    return db().officialSource.findMany({ orderBy: { organization: "asc" } });
  }

  async listUsable(verifiedAfter: Date, limit: number): Promise<SourceRecord[]> {
    return db().officialSource.findMany({
      where: {
        active: true,
        lastVerifiedAt: { gte: verifiedAfter },
      },
      orderBy: { lastVerifiedAt: "desc" },
      take: limit,
    });
  }

  async findByUrl(url: string): Promise<SourceRecord | null> {
    return db().officialSource.findUnique({ where: { url } });
  }

  async markVerified(sourceId: string, at: Date): Promise<void> {
    await db().officialSource.update({
      where: { id: sourceId },
      data: { lastVerifiedAt: at, active: true },
    });
  }

  async linkToCase(input: {
    caseId: string;
    sourceId: string;
    claim: string;
  }): Promise<void> {
    // Повтор — не ошибка: один и тот же источник встречается в плане и в
    // следующем разборе. Уникальность держит база.
    await db().caseSource.upsert({
      where: {
        caseId_sourceId_claim: {
          caseId: input.caseId,
          sourceId: input.sourceId,
          claim: input.claim,
        },
      },
      update: {},
      create: input,
    });
  }

  async listForCase(
    caseId: string,
  ): Promise<Array<{ claim: string; source: SourceRecord }>> {
    const rows = await db().caseSource.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
      include: { source: true },
    });
    return rows.map((row) => ({ claim: row.claim, source: row.source }));
  }

  async markUnavailable(sourceId: string, reason: string): Promise<void> {
    // Недоступный источник выключается, но не удаляется: запись о том, что
    // он когда-то был и перестал открываться, важнее чистоты таблицы.
    await db().officialSource.update({
      where: { id: sourceId },
      data: { active: false, content: `INDISPONÍVEL: ${reason}`.slice(0, 500) },
    });
  }
}
