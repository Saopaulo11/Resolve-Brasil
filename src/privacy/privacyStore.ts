import type { DeletionStatus } from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Запросы на удаление данных (§64).
 */
export type DeletionRequestRecord = {
  id: string;
  userId: string;
  status: DeletionStatus;
  reason: string | null;
  requestedAt: Date;
  executeAfter: Date;
  cancelledAt: Date | null;
  executedAt: Date | null;
};

export interface DeletionRequestStore {
  create(input: {
    userId: string;
    reason: string | null;
    executeAfter: Date;
    ipPrefix: string | null;
  }): Promise<DeletionRequestRecord>;
  findPendingForUser(userId: string): Promise<DeletionRequestRecord | null>;
  listDue(now: Date, limit: number): Promise<DeletionRequestRecord[]>;
  cancel(requestId: string, at: Date): Promise<void>;
  markExecuted(requestId: string, at: Date): Promise<void>;
}

export class PrismaDeletionRequestStore implements DeletionRequestStore {
  async create(input: {
    userId: string;
    reason: string | null;
    executeAfter: Date;
    ipPrefix: string | null;
  }): Promise<DeletionRequestRecord> {
    return db().deletionRequest.create({ data: input });
  }

  async findPendingForUser(userId: string): Promise<DeletionRequestRecord | null> {
    return db().deletionRequest.findFirst({
      where: { userId, status: "PENDENTE" },
      orderBy: { requestedAt: "desc" },
    });
  }

  async listDue(now: Date, limit: number): Promise<DeletionRequestRecord[]> {
    return db().deletionRequest.findMany({
      where: { status: "PENDENTE", executeAfter: { lte: now } },
      take: limit,
    });
  }

  async cancel(requestId: string, at: Date): Promise<void> {
    await db().deletionRequest.updateMany({
      where: { id: requestId, status: "PENDENTE" },
      data: { status: "CANCELADO", cancelledAt: at },
    });
  }

  async markExecuted(requestId: string, at: Date): Promise<void> {
    await db().deletionRequest.update({
      where: { id: requestId },
      data: { status: "EXECUTADO", executedAt: at },
    });
  }
}
