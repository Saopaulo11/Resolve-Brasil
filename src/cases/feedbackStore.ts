import type { FeedbackRating, FeedbackReason } from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Обратная связь по ответам AI (§52).
 *
 * Нужна не для украшения интерфейса: без неё нечем измерить, помогает
 * система или нет, и качество остаётся вопросом мнения.
 */
export type FeedbackRecord = {
  id: string;
  userId: string | null;
  caseId: string | null;
  messageId: string | null;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  comment: string | null;
  createdAt: Date;
};

export type CreateFeedbackInput = {
  userId: string;
  caseId: string;
  messageId: string;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  comment: string | null;
};

export interface FeedbackStore {
  create(input: CreateFeedbackInput): Promise<FeedbackRecord>;
  findForMessage(messageId: string, userId: string): Promise<FeedbackRecord | null>;
  /**
   * Оценённые сообщения дела — одним запросом.
   *
   * Иначе страница дела спрашивает базу по разу на сообщение: у дела с
   * двадцатью ответами это двадцать обращений на каждый просмотр.
   */
  ratedMessageIds(caseId: string, userId: string): Promise<Set<string>>;
  listRecent(limit: number): Promise<FeedbackRecord[]>;
  countByRating(): Promise<{ sim: number; nao: number }>;
}

export class PrismaFeedbackStore implements FeedbackStore {
  async create(input: CreateFeedbackInput): Promise<FeedbackRecord> {
    return db().feedback.create({ data: input });
  }

  async findForMessage(
    messageId: string,
    userId: string,
  ): Promise<FeedbackRecord | null> {
    return db().feedback.findFirst({ where: { messageId, userId } });
  }

  async ratedMessageIds(caseId: string, userId: string): Promise<Set<string>> {
    const rows = await db().feedback.findMany({
      where: { caseId, userId, messageId: { not: null } },
      select: { messageId: true },
    });
    return new Set(rows.map((row) => row.messageId).filter((id): id is string => id !== null));
  }

  async listRecent(limit: number): Promise<FeedbackRecord[]> {
    return db().feedback.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async countByRating(): Promise<{ sim: number; nao: number }> {
    const [sim, nao] = await Promise.all([
      db().feedback.count({ where: { rating: "SIM" } }),
      db().feedback.count({ where: { rating: "NAO" } }),
    ]);
    return { sim, nao };
  }
}
