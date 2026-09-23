import {
  MemoryAdminSessionStore,
  MemoryAdminUserStore,
  MemoryLoginAttemptStore,
} from "../admin/memoryAdminStore";
import { MemoryAnalyticsStore } from "../analytics/memoryAnalyticsStore";
import { MemoryCaseStore } from "../cases/memoryCaseStore";
import {
  MemoryAuditStore,
  MemoryDocumentStore,
  MemoryFactStore,
} from "../documents/memoryDocumentStore";
import {
  MemoryNotificationStore,
  MemoryReminderStore,
} from "../notifications/memoryReminderStore";
import { MemorySourceStore } from "../sources/memorySourceStore";
import {
  MemoryConsentStore,
  MemoryOtpStore,
  MemorySessionStore,
  MemoryUserStore,
} from "./memoryStores";
import type { Stores } from "./storeRegistry";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Полный набор хранилищ в памяти, в одном месте.
 *
 * Собран сюда не ради краткости: раньше список повторялся в регистре и в
 * каждом тесте, и добавление любого нового хранилища роняло тесты, которые
 * к нему отношения не имеют. Теперь место одно.
 */
export type MemoryStores = Stores & {
  users: MemoryUserStore;
  otp: MemoryOtpStore;
  sessions: MemorySessionStore;
  consents: MemoryConsentStore;
  cases: MemoryCaseStore;
  documents: MemoryDocumentStore;
  facts: MemoryFactStore;
  audit: MemoryAuditStore;
  sources: MemorySourceStore;
  reminders: MemoryReminderStore;
  notifications: MemoryNotificationStore;
  analytics: MemoryAnalyticsStore;
  admins: MemoryAdminUserStore;
  adminSessions: MemoryAdminSessionStore;
  loginAttempts: MemoryLoginAttemptStore;
};

export function createMemoryStores(): MemoryStores {
  return {
    users: new MemoryUserStore(),
    otp: new MemoryOtpStore(),
    sessions: new MemorySessionStore(),
    consents: new MemoryConsentStore(),
    cases: new MemoryCaseStore(),
    documents: new MemoryDocumentStore(),
    facts: new MemoryFactStore(),
    audit: new MemoryAuditStore(),
    sources: new MemorySourceStore(),
    reminders: new MemoryReminderStore(),
    notifications: new MemoryNotificationStore(),
    analytics: new MemoryAnalyticsStore(),
    admins: new MemoryAdminUserStore(),
    adminSessions: new MemoryAdminSessionStore(),
    loginAttempts: new MemoryLoginAttemptStore(),
  };
}
