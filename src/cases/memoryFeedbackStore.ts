import { randomUUID } from "node:crypto";

import type {
  CreateFeedbackInput,
  FeedbackRecord,
  FeedbackStore,
} from "./feedbackStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 */
export class MemoryFeedbackStore implements FeedbackStore {
  private readonly items = new Map<string, FeedbackRecord>();

  async create(input: CreateFeedbackInput): Promise<FeedbackRecord> {
    const record: FeedbackRecord = {
      id: randomUUID(),
      userId: input.userId,
      caseId: input.caseId,
      messageId: input.messageId,
      rating: input.rating,
      reason: input.reason,
      comment: input.comment,
      createdAt: new Date(),
    };
    this.items.set(record.id, record);
    return record;
  }

  async findForMessage(
    messageId: string,
    userId: string,
  ): Promise<FeedbackRecord | null> {
    for (const item of this.items.values()) {
      if (item.messageId === messageId && item.userId === userId) return item;
    }
    return null;
  }

  async listRecent(limit: number): Promise<FeedbackRecord[]> {
    return [...this.items.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async countByRating(): Promise<{ sim: number; nao: number }> {
    const all = [...this.items.values()];
    return {
      sim: all.filter((item) => item.rating === "SIM").length,
      nao: all.filter((item) => item.rating === "NAO").length,
    };
  }
}
