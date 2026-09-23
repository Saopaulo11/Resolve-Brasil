import type { AdminRole } from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Хранение администраторов, их сессий и попыток входа (§51).
 */
export type AdminUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: AdminRole;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export type AdminSessionRecord = {
  id: string;
  adminUserId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export interface AdminUserStore {
  findByEmail(email: string): Promise<AdminUserRecord | null>;
  findById(adminUserId: string): Promise<AdminUserRecord | null>;
  create(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUserRecord>;
  markLogin(adminUserId: string, at: Date): Promise<void>;
  listAll(): Promise<AdminUserRecord[]>;
}

export interface AdminSessionStore {
  create(input: {
    adminUserId: string;
    tokenHash: string;
    ipPrefix: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<AdminSessionRecord | null>;
  revokeByTokenHash(tokenHash: string, at: Date): Promise<void>;
}

export interface LoginAttemptStore {
  record(input: { email: string; ipPrefix: string | null; success: boolean }): Promise<void>;
  countFailuresSince(email: string, since: Date): Promise<number>;
}

export class PrismaAdminUserStore implements AdminUserStore {
  async findByEmail(email: string): Promise<AdminUserRecord | null> {
    return db().adminUser.findUnique({ where: { email } });
  }

  async findById(adminUserId: string): Promise<AdminUserRecord | null> {
    return db().adminUser.findUnique({ where: { id: adminUserId } });
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUserRecord> {
    return db().adminUser.create({ data: input });
  }

  async markLogin(adminUserId: string, at: Date): Promise<void> {
    await db().adminUser.update({
      where: { id: adminUserId },
      data: { lastLoginAt: at },
    });
  }

  async listAll(): Promise<AdminUserRecord[]> {
    return db().adminUser.findMany({ orderBy: { email: "asc" } });
  }
}

export class PrismaAdminSessionStore implements AdminSessionStore {
  async create(input: {
    adminUserId: string;
    tokenHash: string;
    ipPrefix: string | null;
    userAgent: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await db().adminSession.create({ data: input });
  }

  async findByTokenHash(tokenHash: string): Promise<AdminSessionRecord | null> {
    return db().adminSession.findUnique({
      where: { tokenHash },
      select: { id: true, adminUserId: true, expiresAt: true, revokedAt: true },
    });
  }

  async revokeByTokenHash(tokenHash: string, at: Date): Promise<void> {
    await db().adminSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

export class PrismaLoginAttemptStore implements LoginAttemptStore {
  async record(input: {
    email: string;
    ipPrefix: string | null;
    success: boolean;
  }): Promise<void> {
    await db().adminLoginAttempt.create({ data: input });
  }

  async countFailuresSince(email: string, since: Date): Promise<number> {
    return db().adminLoginAttempt.count({
      where: { email, success: false, createdAt: { gte: since } },
    });
  }
}
