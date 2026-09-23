import { randomUUID } from "node:crypto";

import type { DeletionRequestRecord, DeletionRequestStore } from "./privacyStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 */
export class MemoryDeletionRequestStore implements DeletionRequestStore {
  private readonly requests = new Map<string, DeletionRequestRecord>();

  async create(input: {
    userId: string;
    reason: string | null;
    executeAfter: Date;
    ipPrefix: string | null;
  }): Promise<DeletionRequestRecord> {
    const record: DeletionRequestRecord = {
      id: randomUUID(),
      userId: input.userId,
      status: "PENDENTE",
      reason: input.reason,
      requestedAt: new Date(),
      executeAfter: input.executeAfter,
      cancelledAt: null,
      executedAt: null,
    };
    this.requests.set(record.id, record);
    return record;
  }

  async findPendingForUser(userId: string): Promise<DeletionRequestRecord | null> {
    for (const request of this.requests.values()) {
      if (request.userId === userId && request.status === "PENDENTE") return request;
    }
    return null;
  }

  async listDue(now: Date, limit: number): Promise<DeletionRequestRecord[]> {
    return [...this.requests.values()]
      .filter(
        (request) =>
          request.status === "PENDENTE" &&
          request.executeAfter.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  async cancel(requestId: string, at: Date): Promise<void> {
    const request = this.requests.get(requestId);
    if (request && request.status === "PENDENTE") {
      request.status = "CANCELADO";
      request.cancelledAt = at;
    }
  }

  async markExecuted(requestId: string, at: Date): Promise<void> {
    const request = this.requests.get(requestId);
    if (request) {
      request.status = "EXECUTADO";
      request.executedAt = at;
    }
  }

  /** Только для тестов. */
  listAll(): DeletionRequestRecord[] {
    return [...this.requests.values()];
  }
}
