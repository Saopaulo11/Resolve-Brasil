import { randomUUID } from "node:crypto";

import type { ConsentSource, ConsentType } from "../generated/prisma/enums";
import type {
  ConsentStore,
  MarketingUpdate,
  OtpChallengeRecord,
  OtpStore,
  SessionRecord,
  SessionStore,
  UserRecord,
  UserStore,
} from "./stores";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Хранилища в памяти процесса. Нужны для двух вещей: гонять тесты входа без
 * PostgreSQL и поднимать стенд, пока базы ещё нет.
 *
 * Данные исчезают при перезапуске. В production эти классы не создаются —
 * loadConfig() там требует DATABASE_URL, и выбор падает на Prisma.
 */

export class MemoryUserStore implements UserStore {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byPhone = new Map<string, string>();

  async findByPhone(phone: string): Promise<UserRecord | null> {
    const id = this.byPhone.get(phone);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findById(userId: string): Promise<UserRecord | null> {
    return this.byId.get(userId) ?? null;
  }

  async create(phone: string): Promise<UserRecord> {
    const user: UserRecord = {
      id: randomUUID(),
      phone,
      phoneVerified: true,
      displayName: null,
      marketingConsent: false,
      marketingConsentAt: null,
      marketingUnsubscribedAt: null,
      caseNotifications: true,
      marketingNotifications: false,
      createdAt: new Date(),
    };
    this.byId.set(user.id, user);
    this.byPhone.set(phone, user.id);
    return user;
  }

  async markPhoneVerified(userId: string): Promise<void> {
    const user = this.byId.get(userId);
    if (user) user.phoneVerified = true;
  }

  async deleteUser(userId: string): Promise<void> {
    const user = this.byId.get(userId);
    if (!user) return;
    this.byId.delete(userId);
    this.byPhone.delete(user.phone);
  }

  async setMarketing(userId: string, update: MarketingUpdate): Promise<void> {
    const user = this.byId.get(userId);
    if (!user) return;
    user.marketingConsent = update.consent;
    user.marketingNotifications = update.consent;
    user.marketingConsentAt = update.consent ? update.at : null;
    if (!update.consent) user.marketingUnsubscribedAt = update.at;
  }
}

export class MemoryOtpStore implements OtpStore {
  private readonly challenges = new Map<string, OtpChallengeRecord>();

  async invalidateActive(phone: string, now: Date): Promise<void> {
    for (const challenge of this.challenges.values()) {
      if (
        challenge.phone === phone &&
        !challenge.consumedAt &&
        !challenge.invalidatedAt &&
        challenge.expiresAt.getTime() > now.getTime()
      ) {
        challenge.invalidatedAt = now;
      }
    }
  }

  async create(input: {
    phone: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    ipPrefix: string | null;
  }): Promise<OtpChallengeRecord> {
    const challenge: OtpChallengeRecord = {
      id: randomUUID(),
      phone: input.phone,
      codeHash: input.codeHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async findLatest(phone: string): Promise<OtpChallengeRecord | null> {
    let latest: OtpChallengeRecord | null = null;
    for (const challenge of this.challenges.values()) {
      if (challenge.phone !== phone) continue;
      if (!latest || challenge.createdAt.getTime() > latest.createdAt.getTime()) {
        latest = challenge;
      }
    }
    return latest;
  }

  async findRecentByCodeHash(
    phone: string,
    codeHash: string,
    since: Date,
  ): Promise<OtpChallengeRecord | null> {
    let found: OtpChallengeRecord | null = null;
    for (const challenge of this.challenges.values()) {
      if (challenge.phone !== phone) continue;
      if (challenge.codeHash !== codeHash) continue;
      if (challenge.createdAt.getTime() < since.getTime()) continue;
      if (!found || challenge.createdAt.getTime() > found.createdAt.getTime()) {
        found = challenge;
      }
    }
    return found;
  }

  async recordAttempt(challengeId: string): Promise<number> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return 0;
    challenge.attempts += 1;
    return challenge.attempts;
  }

  async consume(challengeId: string, now: Date): Promise<void> {
    const challenge = this.challenges.get(challengeId);
    if (challenge) challenge.consumedAt = now;
  }
}

export class MemorySessionStore implements SessionStore {
  private readonly byHash = new Map<
    string,
    SessionRecord & { tokenHash: string; lastSeenAt: Date }
  >();

  async create(input: {
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipPrefix: string | null;
    expiresAt: Date;
  }): Promise<void> {
    this.byHash.set(input.tokenHash, {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      lastSeenAt: new Date(),
    });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.byHash.get(tokenHash);
    if (!session) return null;
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    };
  }

  async touch(sessionId: string, olderThan: Date, now: Date): Promise<void> {
    for (const session of this.byHash.values()) {
      if (session.id === sessionId && session.lastSeenAt.getTime() < olderThan.getTime()) {
        session.lastSeenAt = now;
      }
    }
  }

  async revokeByTokenHash(tokenHash: string, now: Date): Promise<void> {
    const session = this.byHash.get(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = now;
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    for (const session of this.byHash.values()) {
      if (session.userId === userId && !session.revokedAt) session.revokedAt = now;
    }
  }
}

export type RecordedConsent = {
  userId: string;
  type: ConsentType;
  version: string;
  accepted: boolean;
  source: ConsentSource;
};

export class MemoryConsentStore implements ConsentStore {
  readonly records: RecordedConsent[] = [];

  async record(input: {
    userId: string;
    type: ConsentType;
    version: string;
    accepted: boolean;
    source: ConsentSource;
    ipPrefix: string | null;
  }): Promise<void> {
    this.records.push({
      userId: input.userId,
      type: input.type,
      version: input.version,
      accepted: input.accepted,
      source: input.source,
    });
  }
}
