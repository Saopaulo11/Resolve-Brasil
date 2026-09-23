import { randomUUID } from "node:crypto";

import type { AdminRole } from "../generated/prisma/enums";
import type {
  AdminSessionRecord,
  AdminSessionStore,
  AdminUserRecord,
  AdminUserStore,
  LoginAttemptStore,
} from "./adminStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 */
export class MemoryAdminUserStore implements AdminUserStore {
  private readonly byId = new Map<string, AdminUserRecord>();

  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    for (const admin of this.byId.values()) {
      if (admin.email === email) return admin;
    }
    return null;
  }

  async findById(adminUserId: string): Promise<AdminUserRecord | null> {
    return this.byId.get(adminUserId) ?? null;
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUserRecord> {
    const record: AdminUserRecord = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      active: true,
      lastLoginAt: null,
      createdAt: new Date(),
    };
    this.byId.set(record.id, record);
    return record;
  }

  async markLogin(adminUserId: string, at: Date): Promise<void> {
    const admin = this.byId.get(adminUserId);
    if (admin) admin.lastLoginAt = at;
  }

  async listAll(): Promise<AdminUserRecord[]> {
    return [...this.byId.values()].sort((a, b) => a.email.localeCompare(b.email));
  }
}

export class MemoryAdminSessionStore implements AdminSessionStore {
  private readonly byHash = new Map<string, AdminSessionRecord & { tokenHash: string }>();

  async create(input: {
    adminUserId: string;
    tokenHash: string;
    ipPrefix: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    this.byHash.set(input.tokenHash, {
      id: randomUUID(),
      adminUserId: input.adminUserId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AdminSessionRecord | null> {
    return this.byHash.get(tokenHash) ?? null;
  }

  async revokeByTokenHash(tokenHash: string, at: Date): Promise<void> {
    const session = this.byHash.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = at;
  }
}

export class MemoryLoginAttemptStore implements LoginAttemptStore {
  readonly attempts: Array<{
    email: string;
    ipPrefix: string | null;
    success: boolean;
    createdAt: Date;
  }> = [];

  async record(input: {
    email: string;
    ipPrefix: string | null;
    success: boolean;
  }): Promise<void> {
    this.attempts.push({ ...input, createdAt: new Date() });
  }

  async countFailuresSince(email: string, since: Date): Promise<number> {
    return this.attempts.filter(
      (attempt) =>
        attempt.email === email &&
        !attempt.success &&
        attempt.createdAt.getTime() >= since.getTime(),
    ).length;
  }
}
