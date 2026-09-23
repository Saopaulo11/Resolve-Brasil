import { createHash } from "node:crypto";

import { db, isDatabaseConfigured } from "../services/db";
import { logger } from "../utils/logger";

/**
 * Продуктовые события (§83, §84).
 *
 * В аналитику не пишется user_id — только псевдоним, полученный однонаправленным
 * хешем. Иначе выгрузка событий восстанавливает связь с конкретным человеком, а
 * §55 требует обратного: аналитика не должна вести к личности.
 */
export const TRACKED_EVENTS = [
  "landing_view",
  "case_started",
  "case_created",
  "otp_requested",
  "otp_verified",
  "document_uploaded",
  "document_processed",
  "action_plan_viewed",
  "draft_created",
  "response_uploaded",
  "response_analyzed",
  "reminder_created",
  "case_resolved",
  "feedback_submitted",
  "marketing_opt_in",
  "marketing_opt_out",
  // §84 — события для Consumer Intelligence.
  "case_category_created",
  "case_category_changed",
  "company_detected",
  "industry_detected",
  "payment_method_detected",
  "resolution_status_changed",
  "case_escalated",
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

/** Соль псевдонима. Без секрета хеш от user_id перебирается за секунды. */
function pseudonymize(userId: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${userId}`).digest("hex").slice(0, 32);
}

export type TrackOptions = {
  userId?: string | null;
  properties?: Record<string, string | number | boolean | null>;
  /// §82: демо-данные помечаются и не идут в продуктовую аналитику.
  isDemo?: boolean;
};

export async function trackEvent(
  name: TrackedEvent,
  options: TrackOptions = {},
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const secret = process.env.SESSION_SECRET ?? "";
  const subjectKey =
    options.userId && secret ? pseudonymize(options.userId, secret) : null;

  try {
    await db().analyticsEvent.create({
      data: {
        name,
        subjectKey,
        properties: options.properties ?? undefined,
        isDemo: options.isDemo ?? false,
      },
    });
  } catch (error) {
    // Аналитика не имеет права ломать пользовательский сценарий.
    logger().warn({ err: error, event: name }, "falha ao registrar evento");
  }
}

/** Диапазон суммы вместо точного значения (§56). */
export function amountBucket(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  if (amount < 50) return "0-50";
  if (amount < 200) return "50-200";
  if (amount < 500) return "200-500";
  if (amount < 1000) return "500-1000";
  if (amount < 5000) return "1000-5000";
  return "5000+";
}

export { pseudonymize };
