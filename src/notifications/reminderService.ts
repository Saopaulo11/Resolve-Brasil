import { loadConfig } from "../config/env";
import { trackEvent } from "../analytics/events";
import { logger, maskPhone } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import { notificationProvider } from "./providers";
import type { ReminderRecord } from "./reminderStore";

/**
 * Напоминания (§37) и их доставка (§38).
 *
 * Напоминание о ходе дела — сервисное сообщение, а не рассылка. Оно не
 * зависит от маркетингового согласия: человек попросил напомнить о своём
 * деле, и отказ от новостей этого не отменяет (§17).
 */

/** Готовые сроки. Произвольная дата — отдельным полем. */
export const PRESETS = [
  { value: "3d", days: 3, label: "Em 3 dias" },
  { value: "7d", days: 7, label: "Em 7 dias" },
  { value: "15d", days: 15, label: "Em 15 dias" },
  { value: "30d", days: 30, label: "Em 30 dias" },
] as const;

export type PresetValue = (typeof PRESETS)[number]["value"];

/** Дальше года планировать бессмысленно: дело столько не живёт. */
const MAX_DAYS_AHEAD = 365;
const MIN_MINUTES_AHEAD = 5;

export type CreateReminderError = "prazo_invalido" | "prazo_passado" | "prazo_distante";

export const REMINDER_ERROR_MESSAGES: Record<CreateReminderError, string> = {
  prazo_invalido: "Escolha quando quer ser lembrado.",
  prazo_passado: "A data precisa estar no futuro.",
  prazo_distante: "Escolha uma data dentro do próximo ano.",
};

export type CreateReminderResult =
  | { ok: true; reminder: ReminderRecord }
  | { ok: false; reason: CreateReminderError };

/** Момент напоминания из готового срока или введённой даты. */
export function resolveScheduledAt(
  preset: string | null,
  customDate: string | null,
  now: Date = new Date(),
): Date | CreateReminderError {
  if (preset) {
    const found = PRESETS.find((item) => item.value === preset);
    if (!found) return "prazo_invalido";
    return new Date(now.getTime() + found.days * 24 * 60 * 60 * 1000);
  }

  if (!customDate) return "prazo_invalido";

  // Дата приходит из <input type="date"> как YYYY-MM-DD. Без времени она
  // разобралась бы как полночь UTC — в Бразилии это предыдущий день.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(customDate.trim());
  if (!match) return "prazo_invalido";

  const [, year, month, day] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    9,
    0,
    0,
  );
  if (Number.isNaN(parsed.getTime())) return "prazo_invalido";

  if (parsed.getTime() < now.getTime() + MIN_MINUTES_AHEAD * 60_000) {
    return "prazo_passado";
  }
  if (parsed.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    return "prazo_distante";
  }

  return parsed;
}

export async function createReminder(input: {
  userId: string;
  caseId: string;
  publicId: string;
  title: string;
  preset: string | null;
  customDate: string | null;
}): Promise<CreateReminderResult> {
  const scheduledAt = resolveScheduledAt(input.preset, input.customDate);
  if (typeof scheduledAt === "string") return { ok: false, reason: scheduledAt };

  const reminder = await stores().reminders.create({
    userId: input.userId,
    caseId: input.caseId,
    type: "acompanhamento",
    title: input.title,
    scheduledAt,
  });

  void trackEvent("reminder_created", { userId: input.userId });
  return { ok: true, reminder };
}

/** Отмена. Чужое напоминание отменить нельзя — проверка по делу. */
export async function cancelReminder(input: {
  reminderId: string;
  caseId: string;
}): Promise<boolean> {
  const reminder = await stores().reminders.findById(input.reminderId);
  if (!reminder || reminder.caseId !== input.caseId) return false;

  await stores().reminders.cancel(input.reminderId);
  return true;
}

export async function listReminders(caseId: string): Promise<ReminderRecord[]> {
  return stores().reminders.listForCase(caseId);
}

export type DispatchResult = {
  sent: number;
  failed: number;
  skipped: number;
  cancelled: number;
};

/**
 * Рассылка наступивших напоминаний (§38).
 *
 * Запускается извне — по расписанию. Собственного планировщика в процессе
 * нет намеренно: на нескольких инстансах он дублировал бы отправку, а
 * внешний cron вызывает команду ровно один раз.
 */
export async function dispatchDue(): Promise<DispatchResult> {
  const config = loadConfig();
  const { reminders, users, notifications } = stores();

  const now = new Date();
  const retryBefore = new Date(
    now.getTime() - config.reminders.retryAfterMinutes * 60_000,
  );

  const due = await reminders.listDue(now, retryBefore, config.reminders.batchSize);
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0, cancelled: 0 };

  for (const reminder of due) {
    const user = await users.findById(reminder.userId);

    if (!user) {
      await reminders.cancel(reminder.id);
      result.cancelled += 1;
      continue;
    }

    // Сервисные сообщения не зависят от маркетингового согласия (§17),
    // но если человек выключил уведомления по делам — молчим.
    if (!user.caseNotifications) {
      await reminders.cancel(reminder.id);
      result.skipped += 1;
      continue;
    }

    const text = buildReminderText(reminder);
    const provider = notificationProvider();

    // WhatsApp привычнее в Бразилии; SMS — запасной канал.
    const channel = config.whatsapp.provider === "mock" ? "SMS" : "WHATSAPP";
    const delivery =
      channel === "WHATSAPP"
        ? await provider.sendWhatsApp(user.phone, text)
        : await provider.sendSMS(user.phone, text);

    await notifications.record({
      userId: user.id,
      channel,
      // §17: напоминание о своём деле — услуга, а не рассылка.
      purpose: "SERVICO",
      template: "reminder.acompanhamento",
      // В журнал уведомлений не пишется ни телефон, ни текст сообщения:
      // текст содержит подробности дела (§76).
      payload: { reminderId: reminder.id, caseId: reminder.caseId },
      status: delivery.delivered ? "ENVIADA" : "FALHOU",
      error: delivery.error ?? null,
    });

    if (delivery.delivered) {
      await reminders.markSent(reminder.id, now);
      result.sent += 1;
      continue;
    }

    const attempts = await reminders.markAttemptFailed(reminder.id, now);
    result.failed += 1;

    if (attempts >= config.reminders.maxAttempts) {
      await reminders.cancel(reminder.id);
      result.cancelled += 1;
      logger().warn(
        { reminderId: reminder.id, attempts, phone: maskPhone(user.phone) },
        "lembrete cancelado após tentativas sem sucesso",
      );
    }
  }

  return result;
}

function buildReminderText(reminder: ReminderRecord): string {
  return (
    `Resolve Brasil: ${reminder.title}\n\n` +
    "Abra seu caso para ver o próximo passo."
  );
}

export { MAX_DAYS_AHEAD, MIN_MINUTES_AHEAD, buildReminderText };
