import {
  PrismaAuditStore,
  PrismaDocumentStore,
  PrismaFactStore,
  type AuditStore,
  type DocumentStore,
  type FactStore,
} from "../documents/documentStore";
import { PrismaCaseStore, type CaseStore } from "../cases/caseStore";
import {
  PrismaNotificationStore,
  PrismaReminderStore,
  type NotificationStore,
  type ReminderStore,
} from "../notifications/reminderStore";
import { PrismaSourceStore, type SourceStore } from "../sources/sourceStore";
import {
  PrismaAdminSessionStore,
  PrismaAdminUserStore,
  PrismaLoginAttemptStore,
  type AdminSessionStore,
  type AdminUserStore,
  type LoginAttemptStore,
} from "../admin/adminStore";
import { PrismaAnalyticsStore, type AnalyticsStore } from "../analytics/analyticsStore";
import { loadConfig } from "../config/env";
import { isDatabaseConfigured } from "../services/db";
import { logger } from "../utils/logger";
import { createMemoryStores } from "./memoryStoreSet";
import {
  PrismaConsentStore,
  PrismaOtpStore,
  PrismaSessionStore,
  PrismaUserStore,
  type ConsentStore,
  type OtpStore,
  type SessionStore,
  type UserStore,
} from "./stores";

/**
 * Выбор хранилищ. Есть DATABASE_URL — Prisma, нет — память.
 *
 * Падать без базы нельзя: до появления PostgreSQL вход всё равно нужно
 * поднимать и проверять. В production этой развилки не существует —
 * loadConfig() там требует DATABASE_URL и не даёт процессу стартовать без него.
 */
export type Stores = {
  users: UserStore;
  otp: OtpStore;
  sessions: SessionStore;
  consents: ConsentStore;
  cases: CaseStore;
  documents: DocumentStore;
  facts: FactStore;
  audit: AuditStore;
  sources: SourceStore;
  reminders: ReminderStore;
  notifications: NotificationStore;
  analytics: AnalyticsStore;
  admins: AdminUserStore;
  adminSessions: AdminSessionStore;
  loginAttempts: LoginAttemptStore;
};

let instance: Stores | null = null;

function build(): Stores {
  if (isDatabaseConfigured()) {
    return {
      users: new PrismaUserStore(),
      otp: new PrismaOtpStore(),
      sessions: new PrismaSessionStore(),
      consents: new PrismaConsentStore(),
      cases: new PrismaCaseStore(),
      documents: new PrismaDocumentStore(),
      facts: new PrismaFactStore(),
      audit: new PrismaAuditStore(),
      sources: new PrismaSourceStore(),
      reminders: new PrismaReminderStore(),
      notifications: new PrismaNotificationStore(),
      analytics: new PrismaAnalyticsStore(),
      admins: new PrismaAdminUserStore(),
      adminSessions: new PrismaAdminSessionStore(),
      loginAttempts: new PrismaLoginAttemptStore(),
    };
  }

  const config = loadConfig();
  if (config.isProduction) {
    // Недостижимо при исправной конфигурации, но пусть будет громко:
    // хранение сессий в памяти в production означало бы молчаливую потерю
    // всех дел при каждом перезапуске.
    throw new Error("Хранилища в памяти недопустимы в production: задайте DATABASE_URL.");
  }

  logger().warn(
    "DATABASE_URL не задан — использую хранилища в памяти. Данные исчезнут " +
      "при перезапуске. Так можно только в разработке.",
  );

  return createMemoryStores();
}

export function stores(): Stores {
  if (!instance) instance = build();
  return instance;
}

/** Для тестов: подставить свои хранилища. */
export function setStores(custom: Stores): void {
  instance = custom;
}

export function resetStores(): void {
  instance = null;
}
