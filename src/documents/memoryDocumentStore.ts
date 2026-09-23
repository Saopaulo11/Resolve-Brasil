import { randomUUID } from "node:crypto";

import type { ExtractionStatus, FactStatus } from "../generated/prisma/enums";
import type {
  AuditEntry,
  AuditRecord,
  AuditStore,
  CaseFactRecord,
  CreateDocumentInput,
  CreateFactInput,
  DocumentRecord,
  DocumentStore,
  FactStore,
} from "./documentStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Документы, факты и журнал доступа в памяти процесса — чтобы проверять
 * разграничение доступа и путь подтверждения фактов без PostgreSQL.
 */
export class MemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, DocumentRecord>();

  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      id: randomUUID(),
      caseId: input.caseId,
      userId: input.userId,
      filename: input.filename,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      storageKey: input.storageKey,
      kind: input.kind,
      extractionStatus: "PENDENTE",
      extractionError: null,
      checksumSha256: input.checksumSha256,
      scanStatus: input.scanStatus,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.documents.set(record.id, record);
    return record;
  }

  async findById(documentId: string): Promise<DocumentRecord | null> {
    return this.documents.get(documentId) ?? null;
  }

  async listForCase(caseId: string): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .filter((doc) => doc.caseId === caseId && doc.deletedAt === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async setExtractionStatus(
    documentId: string,
    status: ExtractionStatus,
    error: string | null,
  ): Promise<void> {
    const record = this.documents.get(documentId);
    if (!record) return;
    record.extractionStatus = status;
    record.extractionError = error;
  }

  async softDelete(documentId: string, at: Date): Promise<void> {
    const record = this.documents.get(documentId);
    if (record) record.deletedAt = at;
  }

  async hardDelete(documentId: string): Promise<void> {
    this.documents.delete(documentId);
  }

  async listOlderThan(before: Date, limit: number): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .filter((doc) => doc.createdAt.getTime() < before.getTime())
      .slice(0, limit);
  }

  async listRecent(limit: number): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export class MemoryFactStore implements FactStore {
  private readonly facts = new Map<string, CaseFactRecord>();

  async createMany(inputs: CreateFactInput[]): Promise<CaseFactRecord[]> {
    return inputs.map((input) => {
      const record: CaseFactRecord = {
        id: randomUUID(),
        caseId: input.caseId,
        documentId: input.documentId,
        field: input.field,
        value: input.value,
        source: input.source,
        status: "UNCONFIRMED",
        confidence: input.confidence,
        confirmedAt: null,
        createdAt: new Date(),
      };
      this.facts.set(record.id, record);
      return record;
    });
  }

  async listForCase(caseId: string): Promise<CaseFactRecord[]> {
    return [...this.facts.values()]
      .filter((fact) => fact.caseId === caseId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(factId: string): Promise<CaseFactRecord | null> {
    return this.facts.get(factId) ?? null;
  }

  async updateStatus(
    factId: string,
    status: FactStatus,
    value: string,
    at: Date,
  ): Promise<void> {
    const record = this.facts.get(factId);
    if (!record) return;
    record.status = status;
    record.value = value;
    record.confirmedAt =
      status === "CONFIRMED" || status === "USER_CORRECTED" ? at : null;
  }
}

export class MemoryAuditStore implements AuditStore {
  readonly entries: AuditRecord[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry, id: randomUUID(), createdAt: new Date() });
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const kept = this.entries.filter(
      (entry) => entry.createdAt.getTime() >= before.getTime(),
    );
    const removed = this.entries.length - kept.length;
    this.entries.length = 0;
    this.entries.push(...kept);
    return removed;
  }

  async list(limit: number): Promise<AuditRecord[]> {
    return [...this.entries]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
