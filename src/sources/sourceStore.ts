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

  async markUnavailable(sourceId: string, reason: string): Promise<void> {
    // Недоступный источник выключается, но не удаляется: запись о том, что
    // он когда-то был и перестал открываться, важнее чистоты таблицы.
    await db().officialSource.update({
      where: { id: sourceId },
      data: { active: false, content: `INDISPONÍVEL: ${reason}`.slice(0, 500) },
    });
  }
}
