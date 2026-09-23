import type {
  DocumentKind,
  ExtractionStatus,
  FactSource,
  FactStatus,
} from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Границы хранения документов, извлечённых фактов и журнала доступа (§24–§26).
 */
export type DocumentRecord = {
  id: string;
  caseId: string;
  userId: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  kind: DocumentKind;
  extractionStatus: ExtractionStatus;
  extractionError: string | null;
  checksumSha256: string | null;
  scanStatus: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type CreateDocumentInput = {
  caseId: string;
  userId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  kind: DocumentKind;
  checksumSha256: string;
  scanStatus: string;
};

export type CaseFactRecord = {
  id: string;
  caseId: string;
  documentId: string | null;
  field: string;
  value: string;
  source: FactSource;
  status: FactStatus;
  confidence: number | null;
  confirmedAt: Date | null;
  createdAt: Date;
};

export type CreateFactInput = {
  caseId: string;
  documentId: string | null;
  field: string;
  value: string;
  source: FactSource;
  confidence: number | null;
};

export interface DocumentStore {
  create(input: CreateDocumentInput): Promise<DocumentRecord>;
  findById(documentId: string): Promise<DocumentRecord | null>;
  listForCase(caseId: string): Promise<DocumentRecord[]>;
  setExtractionStatus(
    documentId: string,
    status: ExtractionStatus,
    error: string | null,
  ): Promise<void>;
  softDelete(documentId: string, at: Date): Promise<void>;
}

export interface FactStore {
  createMany(facts: CreateFactInput[]): Promise<CaseFactRecord[]>;
  listForCase(caseId: string): Promise<CaseFactRecord[]>;
  findById(factId: string): Promise<CaseFactRecord | null>;
  /** Подтверждение, исправление или отклонение факта пользователем (§26). */
  updateStatus(
    factId: string,
    status: FactStatus,
    value: string,
    at: Date,
  ): Promise<void>;
}

export type AuditEntry = {
  adminUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipPrefix: string | null;
};

export interface AuditStore {
  record(entry: AuditEntry): Promise<void>;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

export class PrismaDocumentStore implements DocumentStore {
  async create(input: CreateDocumentInput): Promise<DocumentRecord> {
    return db().document.create({ data: input });
  }

  async findById(documentId: string): Promise<DocumentRecord | null> {
    return db().document.findUnique({ where: { id: documentId } });
  }

  async listForCase(caseId: string): Promise<DocumentRecord[]> {
    return db().document.findMany({
      where: { caseId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async setExtractionStatus(
    documentId: string,
    status: ExtractionStatus,
    error: string | null,
  ): Promise<void> {
    await db().document.update({
      where: { id: documentId },
      data: { extractionStatus: status, extractionError: error },
    });
  }

  async softDelete(documentId: string, at: Date): Promise<void> {
    await db().document.update({
      where: { id: documentId },
      data: { deletedAt: at },
    });
  }
}

export class PrismaFactStore implements FactStore {
  async createMany(facts: CreateFactInput[]): Promise<CaseFactRecord[]> {
    // createMany не возвращает строки, а они нужны интерфейсу подтверждения.
    return Promise.all(facts.map((fact) => db().caseFact.create({ data: fact })));
  }

  async listForCase(caseId: string): Promise<CaseFactRecord[]> {
    const rows = await db().caseFact.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows as unknown as CaseFactRecord[];
  }

  async findById(factId: string): Promise<CaseFactRecord | null> {
    const row = await db().caseFact.findUnique({ where: { id: factId } });
    return (row as unknown as CaseFactRecord) ?? null;
  }

  async updateStatus(
    factId: string,
    status: FactStatus,
    value: string,
    at: Date,
  ): Promise<void> {
    await db().caseFact.update({
      where: { id: factId },
      data: {
        status,
        value,
        // Отметка времени ставится только при подтверждении: у отклонённого
        // факта её быть не должно, иначе «подтверждено» и «отклонено»
        // перестают различаться по данным.
        confirmedAt: status === "CONFIRMED" || status === "USER_CORRECTED" ? at : null,
      },
    });
  }
}

export class PrismaAuditStore implements AuditStore {
  async record(entry: AuditEntry): Promise<void> {
    await db().auditLog.create({
      data: {
        adminUserId: entry.adminUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata as never,
        ipPrefix: entry.ipPrefix,
      },
    });
  }
}
