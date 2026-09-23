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
