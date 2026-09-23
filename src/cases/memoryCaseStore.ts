import { randomUUID } from "node:crypto";

import type { CaseCategory } from "../generated/prisma/enums";
import type {
  CaseEventRecord,
  CaseMessageRecord,
  CaseRecord,
  CaseStore,
  CreateCaseInput,
  CreateEventInput,
  CreateMessageInput,
} from "./caseStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Дела в памяти процесса: нужны, чтобы проверять создание, список и
 * разграничение доступа тестами без PostgreSQL.
 */
export class MemoryCaseStore implements CaseStore {
  private readonly cases = new Map<string, CaseRecord>();
  private readonly events = new Map<string, CaseEventRecord>();
  private readonly messages = new Map<string, CaseMessageRecord>();

  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const now = new Date();
    const record: CaseRecord = {
      id: randomUUID(),
      publicId: input.publicId,
      userId: input.userId,
      category: input.category,
      subcategory: null,
      companyName: null,
      description: input.description,
      amount: null,
      currency: "BRL",
      paymentMethod: "DESCONHECIDO",
      purchaseDate: null,
      promisedDate: null,
      status: "NOVO",
      currentStep: null,
      escalationLevel: "NENHUM",
      priority: "NORMAL",
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    this.cases.set(record.id, record);
    return record;
  }

  async findByPublicId(publicId: string): Promise<CaseRecord | null> {
    for (const record of this.cases.values()) {
      if (record.publicId === publicId) return record;
    }
    return null;
  }

  async listForUser(userId: string): Promise<CaseRecord[]> {
    return [...this.cases.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async publicIdExists(publicId: string): Promise<boolean> {
    return (await this.findByPublicId(publicId)) !== null;
  }

  async attachToUser(caseId: string, userId: string): Promise<void> {
    const record = this.cases.get(caseId);
    if (record && record.userId === null) {
      record.userId = userId;
      record.updatedAt = new Date();
    }
  }

  async addEvent(input: CreateEventInput): Promise<CaseEventRecord> {
    const event: CaseEventRecord = {
      id: randomUUID(),
      caseId: input.caseId,
      type: input.type,
      title: input.title,
      description: input.description,
      eventDate: input.eventDate,
      source: input.source,
      createdAt: new Date(),
    };
    this.events.set(event.id, event);
    return event;
  }

  async listEvents(caseId: string): Promise<CaseEventRecord[]> {
    return [...this.events.values()]
      .filter((event) => event.caseId === caseId)
      .sort((a, b) => a.eventDate.getTime() - b.eventDate.getTime());
  }

  async addMessage(input: CreateMessageInput): Promise<CaseMessageRecord> {
    const message: CaseMessageRecord = {
      id: randomUUID(),
      caseId: input.caseId,
      direction: input.direction,
      type: input.type,
      content: input.content,
      metadata: input.metadata,
      createdAt: new Date(),
    };
    this.messages.set(message.id, message);
    return message;
  }

  async listMessages(caseId: string): Promise<CaseMessageRecord[]> {
    return [...this.messages.values()]
      .filter((message) => message.caseId === caseId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async setClassification(
    caseId: string,
    category: CaseCategory,
    subcategory: string | null,
  ): Promise<void> {
    const record = this.cases.get(caseId);
    if (!record) return;
    record.category = category;
    record.subcategory = subcategory;
    record.status = "EM_ANALISE";
    record.updatedAt = new Date();
  }
}
