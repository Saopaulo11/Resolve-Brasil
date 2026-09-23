import type {
  CaseCategory,
  CasePriority,
  CaseStatus,
  EscalationLevel,
  FactSource,
  MessageDirection,
  MessageType,
  PaymentMethod,
} from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Границы хранения дел.
 *
 * Сумма ходит строкой, а не числом: деньги в double теряют копейки, а
 * Decimal из Prisma не должен течь в шаблоны и тесты.
 */
export type CaseRecord = {
  id: string;
  publicId: string;
  userId: string | null;
  category: CaseCategory | null;
  subcategory: string | null;
  companyName: string | null;
  companyNormalized: string | null;
  description: string;
  amount: string | null;
  currency: string;
  paymentMethod: PaymentMethod;
  purchaseDate: Date | null;
  promisedDate: Date | null;
  status: CaseStatus;
  currentStep: string | null;
  escalationLevel: EscalationLevel;
  priority: CasePriority;
  /// Грубая география для аналитики. Точный адрес не хранится (§56).
  state: string | null;
  cityBucket: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
};

export type CaseEventRecord = {
  id: string;
  caseId: string;
  type: string;
  title: string;
  description: string | null;
  eventDate: Date;
  source: FactSource;
  createdAt: Date;
};

export type CreateCaseInput = {
  publicId: string;
  /**
   * Пусто, пока человек не вошёл. Описание вводится на главной до входа, и
   * тащить его через форму входа в куке нельзя: 5000 символов не помещаются
   * в 4 КБ, отведённые куке. Поэтому дело создаётся сразу, а привязывается
   * после подтверждения телефона.
   */
  userId: string | null;
  description: string;
  category: CaseCategory | null;
};

export type CreateEventInput = {
  caseId: string;
  type: string;
  title: string;
  description: string | null;
  eventDate: Date;
  source: FactSource;
};

export type CaseMessageRecord = {
  id: string;
  caseId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  metadata: unknown;
  createdAt: Date;
};

export type CreateMessageInput = {
  caseId: string;
  userId: string | null;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  metadata: unknown;
  aiRequestId: string | null;
};

export interface CaseStore {
  create(input: CreateCaseInput): Promise<CaseRecord>;
  findByPublicId(publicId: string): Promise<CaseRecord | null>;
  findById(caseId: string): Promise<CaseRecord | null>;
  listForUser(userId: string): Promise<CaseRecord[]>;
  /** Последние дела — для админки. Текст обращения наружу не выносится. */
  listRecent(limit: number): Promise<CaseRecord[]>;
  publicIdExists(publicId: string): Promise<boolean>;
  attachToUser(caseId: string, userId: string): Promise<void>;
  addEvent(input: CreateEventInput): Promise<CaseEventRecord>;
  listEvents(caseId: string): Promise<CaseEventRecord[]>;
  addMessage(input: CreateMessageInput): Promise<CaseMessageRecord>;
  listMessages(caseId: string): Promise<CaseMessageRecord[]>;
  setStatus(caseId: string, status: CaseStatus): Promise<void>;
  /** Меняется только когда классификация достаточно уверенна (§87). */
  setClassification(
    caseId: string,
    category: CaseCategory,
    subcategory: string | null,
  ): Promise<void>;
}

/** Prisma отдаёт Decimal; наружу он не выходит. */
type PrismaCaseRow = Omit<CaseRecord, "amount"> & { amount: unknown };

function toRecord(row: PrismaCaseRow): CaseRecord {
  return { ...row, amount: row.amount === null ? null : String(row.amount) };
}

export class PrismaCaseStore implements CaseStore {
  async create(input: CreateCaseInput): Promise<CaseRecord> {
    const row = await db().case.create({ data: input });
    return toRecord(row as unknown as PrismaCaseRow);
  }

  async findByPublicId(publicId: string): Promise<CaseRecord | null> {
    const row = await db().case.findUnique({ where: { publicId } });
    return row ? toRecord(row as unknown as PrismaCaseRow) : null;
  }

  async findById(caseId: string): Promise<CaseRecord | null> {
    const row = await db().case.findUnique({ where: { id: caseId } });
    return row ? toRecord(row as unknown as PrismaCaseRow) : null;
  }

  async listForUser(userId: string): Promise<CaseRecord[]> {
    const rows = await db().case.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => toRecord(row as unknown as PrismaCaseRow));
  }

  async listRecent(limit: number): Promise<CaseRecord[]> {
    const rows = await db().case.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => toRecord(row as unknown as PrismaCaseRow));
  }

  async publicIdExists(publicId: string): Promise<boolean> {
    const found = await db().case.findUnique({
      where: { publicId },
      select: { id: true },
    });
    return found !== null;
  }

  async attachToUser(caseId: string, userId: string): Promise<void> {
    // updateMany с условием userId: null — чтобы повторный вход не мог
    // перевесить на себя уже привязанное к другому человеку дело.
    await db().case.updateMany({
      where: { id: caseId, userId: null },
      data: { userId },
    });
  }

  async addEvent(input: CreateEventInput): Promise<CaseEventRecord> {
    return db().caseEvent.create({ data: input });
  }

  async listEvents(caseId: string): Promise<CaseEventRecord[]> {
    return db().caseEvent.findMany({
      where: { caseId },
      orderBy: { eventDate: "asc" },
    });
  }

  async addMessage(input: CreateMessageInput): Promise<CaseMessageRecord> {
    const row = await db().message.create({
      data: {
        caseId: input.caseId,
        userId: input.userId,
        direction: input.direction,
        type: input.type,
        content: input.content,
        metadata: input.metadata as never,
        aiRequestId: input.aiRequestId,
      },
    });
    return row as unknown as CaseMessageRecord;
  }

  async listMessages(caseId: string): Promise<CaseMessageRecord[]> {
    const rows = await db().message.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows as unknown as CaseMessageRecord[];
  }

  async setStatus(caseId: string, status: CaseStatus): Promise<void> {
    await db().case.update({ where: { id: caseId }, data: { status } });
  }

  async setClassification(
    caseId: string,
    category: CaseCategory,
    subcategory: string | null,
  ): Promise<void> {
    await db().case.update({
      where: { id: caseId },
      data: { category, subcategory, status: "EM_ANALISE" },
    });
  }
}
