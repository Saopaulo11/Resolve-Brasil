import { randomUUID } from "node:crypto";

import type {
  CreateNotificationInput,
  CreateReminderInput,
  NotificationRecord,
  NotificationStore,
  ReminderRecord,
  ReminderStore,
} from "./reminderStore";

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 */
export class MemoryReminderStore implements ReminderStore {
  private readonly reminders = new Map<string, ReminderRecord>();

  async create(input: CreateReminderInput): Promise<ReminderRecord> {
    const record: ReminderRecord = {
      id: randomUUID(),
      userId: input.userId,
      caseId: input.caseId,
      type: input.type,
      title: input.title,
      scheduledAt: input.scheduledAt,
      status: "AGENDADO",
      sentAt: null,
      attempts: 0,
      lastAttemptAt: null,
      createdAt: new Date(),
    };
    this.reminders.set(record.id, record);
    return record;
  }

  async findById(reminderId: string): Promise<ReminderRecord | null> {
    return this.reminders.get(reminderId) ?? null;
  }

  async listForCase(caseId: string): Promise<ReminderRecord[]> {
    return [...this.reminders.values()]
      .filter((reminder) => reminder.caseId === caseId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }

  async listDue(now: Date, retryBefore: Date, limit: number): Promise<ReminderRecord[]> {
    return [...this.reminders.values()]
      .filter(
        (reminder) =>
          reminder.status === "AGENDADO" &&
          reminder.scheduledAt.getTime() <= now.getTime() &&
          (reminder.lastAttemptAt === null ||
            reminder.lastAttemptAt.getTime() <= retryBefore.getTime()),
      )
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .slice(0, limit);
  }

  async markSent(reminderId: string, at: Date): Promise<void> {
    const reminder = this.reminders.get(reminderId);
    if (!reminder) return;
    reminder.status = "ENVIADO";
    reminder.sentAt = at;
    reminder.lastAttemptAt = at;
    reminder.attempts += 1;
  }

  async markAttemptFailed(reminderId: string, at: Date): Promise<number> {
    const reminder = this.reminders.get(reminderId);
    if (!reminder) return 0;
    reminder.attempts += 1;
    reminder.lastAttemptAt = at;
    return reminder.attempts;
  }

  async cancel(reminderId: string): Promise<void> {
    const reminder = this.reminders.get(reminderId);
    if (reminder && reminder.status === "AGENDADO") reminder.status = "CANCELADO";
  }
}

export class MemoryNotificationStore implements NotificationStore {
  readonly all: NotificationRecord[] = [];

  async record(input: CreateNotificationInput): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      id: randomUUID(),
      userId: input.userId,
      channel: input.channel,
      purpose: input.purpose,
      template: input.template,
      status: input.status,
      error: input.error,
      createdAt: new Date(),
    };
    this.all.push(record);
    return record;
  }

  async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
    return this.all
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}
