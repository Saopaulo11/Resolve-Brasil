import type { ConsentSource, ConsentType } from "../generated/prisma/enums";
import { db } from "../services/db";
import type { OtpChallengeState } from "./otpPolicy";

/**
 * Границы хранения для входа и согласий.
 *
 * Интерфейсы, а не прямые вызовы Prisma, по одной причине: свойства
 * безопасности входа — перебор кода, повторное использование, гашение
 * предыдущего кода — нужно проверять тестами целиком. С прямыми вызовами
 * Prisma это требует живого PostgreSQL на каждый прогон, и такие тесты
 * в итоге не пишут вовсе.
 */

export type UserRecord = {
  id: string;
  phone: string;
  phoneVerified: boolean;
  displayName: string | null;
  marketingConsent: boolean;
  marketingConsentAt: Date | null;
  marketingUnsubscribedAt: Date | null;
  caseNotifications: boolean;
  marketingNotifications: boolean;
  createdAt: Date;
};

export type OtpChallengeRecord = OtpChallengeState & {
  id: string;
  phone: string;
  codeHash: string;
  createdAt: Date;
};

export type SessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type MarketingUpdate = {
  consent: boolean;
  source: ConsentSource;
  at: Date;
};

export interface UserStore {
  findByPhone(phone: string): Promise<UserRecord | null>;
  findById(userId: string): Promise<UserRecord | null>;
  create(phone: string): Promise<UserRecord>;
  markPhoneVerified(userId: string): Promise<void>;
  setMarketing(userId: string, update: MarketingUpdate): Promise<void>;
  /** Безвозвратно. Каскадом уходят сессии, согласия, напоминания, уведомления. */
  deleteUser(userId: string): Promise<void>;
  /** Для админки (§50). Список без телефона в открытом виде не имеет смысла —
   *  маскирование делает слой представления, а не хранилище. */
  listRecent(limit: number): Promise<UserRecord[]>;
  countAll(): Promise<number>;
}

export interface OtpStore {
  /** Гасит все живые коды номера: новый код обязан обнулять предыдущие (§67). */
  invalidateActive(phone: string, now: Date): Promise<void>;
  create(input: {
    phone: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    ipPrefix: string | null;
  }): Promise<OtpChallengeRecord>;
  /** Последний созданный код номера — нужен и для паузы между отправками. */
  findLatest(phone: string): Promise<OtpChallengeRecord | null>;
  /**
   * Недавний код номера с таким хешем. Нужен, чтобы отличить запоздавшую
   * SMS с уже погашенным кодом от настоящей ошибки набора.
   */
  findRecentByCodeHash(
    phone: string,
    codeHash: string,
    since: Date,
  ): Promise<OtpChallengeRecord | null>;
  /** Возвращает новое число попыток после увеличения. */
  recordAttempt(challengeId: string): Promise<number>;
  consume(challengeId: string, now: Date): Promise<void>;
}

export interface SessionStore {
  create(input: {
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipPrefix: string | null;
    expiresAt: Date;
  }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touch(sessionId: string, olderThan: Date, now: Date): Promise<void>;
  revokeByTokenHash(tokenHash: string, now: Date): Promise<void>;
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}

export interface ConsentStore {
  record(input: {
    userId: string;
    type: ConsentType;
    version: string;
    accepted: boolean;
    source: ConsentSource;
    ipPrefix: string | null;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Реализация на Prisma
// ---------------------------------------------------------------------------

export class PrismaUserStore implements UserStore {
  async findByPhone(phone: string): Promise<UserRecord | null> {
    return db().user.findUnique({ where: { phone } });
  }

  async findById(userId: string): Promise<UserRecord | null> {
    return db().user.findUnique({ where: { id: userId } });
  }

  async create(phone: string): Promise<UserRecord> {
    return db().user.create({ data: { phone, phoneVerified: true } });
  }

  async markPhoneVerified(userId: string): Promise<void> {
    await db().user.update({
      where: { id: userId },
      data: { phoneVerified: true },
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await db().user.delete({ where: { id: userId } });
  }

  async listRecent(limit: number): Promise<UserRecord[]> {
    return db().user.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async countAll(): Promise<number> {
    return db().user.count();
  }

  async setMarketing(userId: string, update: MarketingUpdate): Promise<void> {
    await db().user.update({
      where: { id: userId },
      data: {
        marketingConsent: update.consent,
        marketingNotifications: update.consent,
        marketingConsentAt: update.consent ? update.at : null,
        marketingConsentSource: update.consent ? update.source : null,
        // Дата отписки не стирается при повторном согласии: история того,
        // что человек однажды отписался, важнее аккуратности поля.
        marketingUnsubscribedAt: update.consent ? undefined : update.at,
      },
    });
  }
}

export class PrismaOtpStore implements OtpStore {
  async invalidateActive(phone: string, now: Date): Promise<void> {
    await db().otpChallenge.updateMany({
      where: { phone, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
      data: { invalidatedAt: now },
    });
  }

  async create(input: {
    phone: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    ipPrefix: string | null;
  }): Promise<OtpChallengeRecord> {
    return db().otpChallenge.create({ data: input });
  }

  async findLatest(phone: string): Promise<OtpChallengeRecord | null> {
    return db().otpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: "desc" },
    });
  }

  async findRecentByCodeHash(
    phone: string,
    codeHash: string,
    since: Date,
  ): Promise<OtpChallengeRecord | null> {
    return db().otpChallenge.findFirst({
      where: { phone, codeHash, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
    });
  }

  async recordAttempt(challengeId: string): Promise<number> {
    // Инкремент на стороне базы: чтение с последующей записью позволило бы
    // двум одновременным попыткам израсходовать один и тот же слот.
    const updated = await db().otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts;
  }

  async consume(challengeId: string, now: Date): Promise<void> {
    await db().otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: now },
    });
  }
}

export class PrismaSessionStore implements SessionStore {
  async create(input: {
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipPrefix: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await db().session.create({ data: input });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return db().session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
  }

  async touch(sessionId: string, olderThan: Date, now: Date): Promise<void> {
    await db().session.updateMany({
      where: { id: sessionId, lastSeenAt: { lt: olderThan } },
      data: { lastSeenAt: now },
    });
  }

  async revokeByTokenHash(tokenHash: string, now: Date): Promise<void> {
    await db().session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await db().session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}

export class PrismaConsentStore implements ConsentStore {
  async record(input: {
    userId: string;
    type: ConsentType;
    version: string;
    accepted: boolean;
    source: ConsentSource;
    ipPrefix: string | null;
  }): Promise<void> {
    await db().consent.create({ data: input });
  }
}
