import type {
  NotificationChannel,
  NotificationPurpose,
  NotificationStatus,
  ReminderStatus,
} from "../generated/prisma/enums";
import { db } from "../services/db";

/**
 * Напоминания и уведомления (§37, §38).
 */
export type ReminderRecord = {
  id: string;
  userId: string;
  caseId: string | null;
  type: string;
  title: string;
  scheduledAt: Date;
  status: ReminderStatus;
  sentAt: Date | null;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
};

export type CreateReminderInput = {
  userId: string;
  caseId: string | null;
  type: string;
  title: string;
  scheduledAt: Date;
};

export interface ReminderStore {
  create(input: CreateReminderInput): Promise<ReminderRecord>;
  findById(reminderId: string): Promise<ReminderRecord | null>;
  listForCase(caseId: string): Promise<ReminderRecord[]>;
  /** Напоминания, которым пора: срок наступил и попытка не в паузе. */
  listDue(now: Date, retryBefore: Date, limit: number): Promise<ReminderRecord[]>;
  markSent(reminderId: string, at: Date): Promise<void>;
  markAttemptFailed(reminderId: string, at: Date): Promise<number>;
  cancel(reminderId: string): Promise<void>;
}

export type NotificationRecord = {
  id: string;
  userId: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  template: string;
  status: NotificationStatus;
  error: string | null;
  createdAt: Date;
};

export type CreateNotificationInput = {
  userId: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  template: string;
  payload: Record<string, unknown> | null;
  status: NotificationStatus;
  error: string | null;
};

export interface NotificationStore {
  record(input: CreateNotificationInput): Promise<NotificationRecord>;
  listForUser(userId: string, limit: number): Promise<NotificationRecord[]>;
  /** Для админки (§50): доставка без содержимого сообщений. */
  listRecent(limit: number): Promise<NotificationRecord[]>;
}

export class PrismaReminderStore implements ReminderStore {
  async create(input: CreateReminderInput): Promise<ReminderRecord> {
    return db().reminder.create({ data: input });
  }

  async findById(reminderId: string): Promise<ReminderRecord | null> {
    return db().reminder.findUnique({ where: { id: reminderId } });
  }

  async listForCase(caseId: string): Promise<ReminderRecord[]> {
    return db().reminder.findMany({
      where: { caseId },
      orderBy: { scheduledAt: "asc" },
    });
  }

  async listDue(now: Date, retryBefore: Date, limit: number): Promise<ReminderRecord[]> {
    return db().reminder.findMany({
      where: {
        status: "AGENDADO",
        scheduledAt: { lte: now },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: retryBefore } }],
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
    });
  }

  async markSent(reminderId: string, at: Date): Promise<void> {
    await db().reminder.update({
      where: { id: reminderId },
      data: { status: "ENVIADO", sentAt: at, lastAttemptAt: at, attempts: { increment: 1 } },
    });
  }

  async markAttemptFailed(reminderId: string, at: Date): Promise<number> {
    const updated = await db().reminder.update({
      where: { id: reminderId },
      data: { attempts: { increment: 1 }, lastAttemptAt: at },
      select: { attempts: true },
    });
    return updated.attempts;
  }

  async cancel(reminderId: string): Promise<void> {
    await db().reminder.updateMany({
      where: { id: reminderId, status: "AGENDADO" },
      data: { status: "CANCELADO" },
    });
  }
}

export class PrismaNotificationStore implements NotificationStore {
  async record(input: CreateNotificationInput): Promise<NotificationRecord> {
    const row = await db().notification.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        purpose: input.purpose,
        template: input.template,
        payload: input.payload as never,
        status: input.status,
        error: input.error,
        sentAt: input.status === "ENVIADA" ? new Date() : null,
      },
    });
    return row as unknown as NotificationRecord;
  }

  async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
    const rows = await db().notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows as unknown as NotificationRecord[];
  }

  async listRecent(limit: number): Promise<NotificationRecord[]> {
    // payload не выбирается намеренно: в нём текст сообщения, а админке
    // для наблюдения за доставкой он не нужен (§51).
    const rows = await db().notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        userId: true,
        channel: true,
        purpose: true,
        template: true,
        status: true,
        error: true,
        createdAt: true,
      },
    });
    return rows as unknown as NotificationRecord[];
  }
}
