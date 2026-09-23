import { loadConfig } from "../config/env";
import type { CaseRecord } from "../cases/caseStore";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import { projectCase } from "./projection";

/**
 * Конвейер Consumer Intelligence (§54).
 *
 *   Дело → структурные данные → очистка → приватность → агрегат → аналитика
 *
 * Запускается при каждом значимом изменении дела. Слепок обновляется по
 * псевдониму, поэтому дублей не возникает: одно дело — одна строка.
 */

/**
 * Телефон демо-пользователя из prisma/seed.ts.
 *
 * Дела этого номера помечаются как демонстрационные и не попадают в
 * продуктовую аналитику (§82). Признак вынесен сюда, чтобы seed и конвейер
 * не разъехались: иначе демо-дела однажды окажутся в отчёте как настоящие.
 */
export const DEMO_PHONE = "+5511900000000";

function analyticsSecret(): string | null {
  const secret = loadConfig().session.secret;
  // Без соли псевдоним дела перебирается по идентификатору — тогда
  // аналитика перестаёт быть обезличенной, и писать её нельзя.
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Обновить слепок дела в аналитике.
 *
 * Никогда не роняет пользовательский сценарий: аналитика — побочный
 * продукт, и её сбой не должен мешать человеку вести своё дело.
 */
export async function refreshProjection(
  caseRecord: CaseRecord,
  options: { confidence?: number | null } = {},
): Promise<void> {
  const secret = analyticsSecret();
  if (!secret) {
    logger().debug("SESSION_SECRET слишком короткий — слепок в аналитику не пишется");
    return;
  }

  try {
    const { users, analytics, companies } = stores();

    const owner = caseRecord.userId ? await users.findById(caseRecord.userId) : null;
    const isDemo = owner?.phone === DEMO_PHONE;

    /**
     * §86. Отрасль берётся у компании дела, а не угадывается по обращению.
     *
     * Компании нет или её отрасль не определилась — остаётся OTHER. Это
     * «не определено», а не «прочее»: в отчёте эти две вещи читаются
     * по-разному, и смешивать их нельзя.
     */
    const company = caseRecord.companyNormalized
      ? await companies.findByNormalized(caseRecord.companyNormalized)
      : null;

    await analytics.upsert(
      projectCase({
        caseRecord,
        industry: company?.industry ?? "OTHER",
        secret,
        confidence: options.confidence ?? null,
        isDemo,
      }),
    );
  } catch (error) {
    logger().warn({ err: error }, "falha ao atualizar projeção analítica");
  }
}
