import { randomUUID } from "node:crypto";

import type { Industry } from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Компании и их написания (§85).
 *
 * Справочника нет и не будет: записи появляются только из того, что назвали
 * сами пользователи. Заранее вбитый список настоящих компаний был бы
 * выдумкой о рынке, которую никто не проверял (§82).
 */
export type CompanyRecord = {
  id: string;
  /** Первое встреченное написание — его и показываем человеку. */
  canonicalName: string;
  normalized: string;
  industry: Industry;
  createdAt: Date;
  updatedAt: Date;
};

export type CompanyAliasRecord = {
  id: string;
  companyId: string;
  alias: string;
  normalized: string;
  confidence: number;
  /** Пока не проверен человеком, автоматически объединять нельзя. */
  reviewed: boolean;
  createdAt: Date;
};

export type CreateCompanyInput = {
  canonicalName: string;
  normalized: string;
  industry: Industry;
};

export interface CompanyStore {
  findByNormalized(normalized: string): Promise<CompanyRecord | null>;
  /** Только проверенные человеком алиасы: непроверенный не объединяет. */
  findByReviewedAlias(normalized: string): Promise<CompanyRecord | null>;
  create(input: CreateCompanyInput): Promise<CompanyRecord>;
  addAlias(input: {
    companyId: string;
    alias: string;
    normalized: string;
    confidence: number;
  }): Promise<void>;
  listAliases(companyId: string): Promise<CompanyAliasRecord[]>;
  /** Алиасы сразу для списка компаний: иначе запрос на каждую строку. */
  listAliasesFor(companyIds: readonly string[]): Promise<Map<string, CompanyAliasRecord[]>>;
  listAll(limit: number): Promise<CompanyRecord[]>;
}

export class PrismaCompanyStore implements CompanyStore {
  async findByNormalized(normalized: string): Promise<CompanyRecord | null> {
    return db().company.findUnique({ where: { normalized } });
  }

  async findByReviewedAlias(normalized: string): Promise<CompanyRecord | null> {
    const alias = await db().companyAlias.findUnique({
      where: { normalized },
      include: { company: true },
    });
    if (!alias || !alias.reviewed) return null;
    return alias.company;
  }

  async create(input: CreateCompanyInput): Promise<CompanyRecord> {
    return db().company.create({ data: input });
  }

  async addAlias(input: {
    companyId: string;
    alias: string;
    normalized: string;
    confidence: number;
  }): Promise<void> {
    // Алиас уже есть — не трогаем: перезапись сбросила бы отметку проверки,
    // поставленную человеком.
    await db().companyAlias.upsert({
      where: { normalized: input.normalized },
      update: {},
      create: { ...input, reviewed: false },
    });
  }

  async listAliases(companyId: string): Promise<CompanyAliasRecord[]> {
    return db().companyAlias.findMany({
      where: { companyId },
      orderBy: { createdAt: "asc" },
    });
  }

  async listAliasesFor(
    companyIds: readonly string[],
  ): Promise<Map<string, CompanyAliasRecord[]>> {
    if (companyIds.length === 0) return new Map();

    const rows = await db().companyAlias.findMany({
      where: { companyId: { in: [...companyIds] } },
      orderBy: { createdAt: "asc" },
    });

    const grouped = new Map<string, CompanyAliasRecord[]>();
    for (const row of rows) {
      const list = grouped.get(row.companyId) ?? [];
      list.push(row);
      grouped.set(row.companyId, list);
    }
    return grouped;
  }

  async listAll(limit: number): Promise<CompanyRecord[]> {
    return db().company.findMany({ orderBy: { canonicalName: "asc" }, take: limit });
  }
}

/** MOCK / DEVELOPMENT ONLY (§79). */
export class MemoryCompanyStore implements CompanyStore {
  readonly companies = new Map<string, CompanyRecord>();
  readonly aliases: CompanyAliasRecord[] = [];

  async findByNormalized(normalized: string): Promise<CompanyRecord | null> {
    return (
      [...this.companies.values()].find((item) => item.normalized === normalized) ?? null
    );
  }

  async findByReviewedAlias(normalized: string): Promise<CompanyRecord | null> {
    const alias = this.aliases.find((item) => item.normalized === normalized);
    if (!alias || !alias.reviewed) return null;
    return this.companies.get(alias.companyId) ?? null;
  }

  async create(input: CreateCompanyInput): Promise<CompanyRecord> {
    const now = new Date();
    const record: CompanyRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.companies.set(record.id, record);
    return record;
  }

  async addAlias(input: {
    companyId: string;
    alias: string;
    normalized: string;
    confidence: number;
  }): Promise<void> {
    if (this.aliases.some((item) => item.normalized === input.normalized)) return;
    this.aliases.push({
      ...input,
      id: randomUUID(),
      reviewed: false,
      createdAt: new Date(),
    });
  }

  async listAliases(companyId: string): Promise<CompanyAliasRecord[]> {
    return this.aliases.filter((item) => item.companyId === companyId);
  }

  async listAliasesFor(
    companyIds: readonly string[],
  ): Promise<Map<string, CompanyAliasRecord[]>> {
    const wanted = new Set(companyIds);
    const grouped = new Map<string, CompanyAliasRecord[]>();
    for (const alias of this.aliases) {
      if (!wanted.has(alias.companyId)) continue;
      const list = grouped.get(alias.companyId) ?? [];
      list.push(alias);
      grouped.set(alias.companyId, list);
    }
    return grouped;
  }

  async listAll(limit: number): Promise<CompanyRecord[]> {
    return [...this.companies.values()]
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, "pt-BR"))
      .slice(0, limit);
  }
}
