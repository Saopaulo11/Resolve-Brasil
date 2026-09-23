import { randomUUID } from "node:crypto";

import type { SourceRecord, SourceStore, UpsertSourceInput } from "./sourceStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Источники в памяти процесса — чтобы проверять тестами, что непроверенный
 * источник не доходит ни до пользователя, ни до модели.
 */
export class MemorySourceStore implements SourceStore {
  private readonly sources = new Map<string, SourceRecord>();
  private readonly links: Array<{ caseId: string; sourceId: string; claim: string }> = [];

  async linkToCase(input: {
    caseId: string;
    sourceId: string;
    claim: string;
  }): Promise<void> {
    const exists = this.links.some(
      (link) =>
        link.caseId === input.caseId &&
        link.sourceId === input.sourceId &&
        link.claim === input.claim,
    );
    if (!exists) this.links.push({ ...input });
  }

  async listForCase(
    caseId: string,
  ): Promise<Array<{ claim: string; source: SourceRecord }>> {
    return this.links
      .filter((link) => link.caseId === caseId)
      .map((link) => ({ claim: link.claim, source: this.sources.get(link.sourceId)! }))
      .filter((item) => item.source !== undefined);
  }

  async upsert(input: UpsertSourceInput): Promise<SourceRecord> {
    const existing = await this.findByUrl(input.url);
    if (existing) return existing;

    const now = new Date();
    const record: SourceRecord = {
      id: randomUUID(),
      organization: input.organization,
      title: input.title,
      url: input.url,
      category: input.category,
      content: null,
      lastVerifiedAt: null,
      active: false,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(record.id, record);
    return record;
  }

  async listAll(): Promise<SourceRecord[]> {
    return [...this.sources.values()].sort((a, b) =>
      a.organization.localeCompare(b.organization),
    );
  }

  async listUsable(verifiedAfter: Date, limit: number): Promise<SourceRecord[]> {
    return [...this.sources.values()]
      .filter(
        (source) =>
          source.active &&
          source.lastVerifiedAt !== null &&
          source.lastVerifiedAt.getTime() >= verifiedAfter.getTime(),
      )
      .sort(
        (a, b) => (b.lastVerifiedAt?.getTime() ?? 0) - (a.lastVerifiedAt?.getTime() ?? 0),
      )
      .slice(0, limit);
  }

  async findByUrl(url: string): Promise<SourceRecord | null> {
    for (const source of this.sources.values()) {
      if (source.url === url) return source;
    }
    return null;
  }

  async markVerified(sourceId: string, at: Date): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    source.lastVerifiedAt = at;
    source.active = true;
    source.updatedAt = new Date();
  }

  async markUnavailable(sourceId: string, reason: string): Promise<void> {
    const source = this.sources.get(sourceId);
    if (!source) return;
    source.active = false;
    source.content = `INDISPONÍVEL: ${reason}`.slice(0, 500);
    source.updatedAt = new Date();
  }
}
