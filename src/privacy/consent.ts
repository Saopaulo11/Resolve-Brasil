import type { ConsentSource } from "../generated/prisma/enums";
import { stores } from "../users/storeRegistry";

/**
 * Согласия (§17, §63).
 *
 * Одна галочка не равна согласию на все цели, поэтому у каждого согласия свой
 * тип и своя версия документа. Версия обязательна: без неё нельзя показать,
 * с какой редакцией условий человек согласился.
 *
 * Меняются эти константы только вместе с текстом соответствующей страницы.
 */
export const TERMS_VERSION = "2026-09-23";
export const PRIVACY_VERSION = "2026-09-23";
export const MARKETING_VERSION = "2026-09-23";

/** Текст галочки маркетинга — ровно как в §17. */
export const MARKETING_CHECKBOX_LABEL =
  "Quero receber novidades, dicas e informações do Resolve Brasil por WhatsApp/SMS.";

/**
 * Согласия, которые фиксируются при создании учётной записи.
 *
 * Маркетинга здесь нет намеренно: регистрация по телефону не означает
 * согласия на рассылку (§17).
 */
export async function recordSignupConsents(input: {
  userId: string;
  source: ConsentSource;
  ipPrefix: string | null;
}): Promise<void> {
  const { consents } = stores();

  await consents.record({
    userId: input.userId,
    type: "TERMS",
    version: TERMS_VERSION,
    accepted: true,
    source: input.source,
    ipPrefix: input.ipPrefix,
  });

  await consents.record({
    userId: input.userId,
    type: "PRIVACY",
    version: PRIVACY_VERSION,
    accepted: true,
    source: input.source,
    ipPrefix: input.ipPrefix,
  });
}

/**
 * Маркетинговое согласие — отдельной записью и отдельным полем у пользователя.
 *
 * Отказ пишется так же, как согласие: чтобы доказать отписку, нужна запись о
 * ней, а не отсутствие записи о согласии.
 */
export async function setMarketingConsent(input: {
  userId: string;
  accepted: boolean;
  source: ConsentSource;
  ipPrefix: string | null;
}): Promise<void> {
  const { consents, users } = stores();
  const at = new Date();

  await consents.record({
    userId: input.userId,
    type: "MARKETING",
    version: MARKETING_VERSION,
    accepted: input.accepted,
    source: input.source,
    ipPrefix: input.ipPrefix,
  });

  await users.setMarketing(input.userId, {
    consent: input.accepted,
    source: input.source,
    at,
  });
}
