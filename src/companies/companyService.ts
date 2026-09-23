import { trackEvent } from "../analytics/events";
import type { CompanyRecord } from "./companyStore";
import { detectIndustry } from "./industry";
import { isUsableCompanyName, normalizeCompanyName } from "./normalize";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";

/**
 * Приведение названия компании к записи справочника (§85, §86).
 *
 * Справочник наполняется тем, что назвали пользователи, и ничем больше.
 * Сопоставление идёт по нормализованному написанию и по алиасам, которые
 * человек отметил проверенными: автоматическое объединение по похожести
 * однажды склеит две разные компании, и разъединить их потом будет нечем.
 */
export async function resolveCompany(rawName: string): Promise<CompanyRecord | null> {
  if (!isUsableCompanyName(rawName)) return null;

  const normalized = normalizeCompanyName(rawName);
  const { companies } = stores();

  const existing =
    (await companies.findByNormalized(normalized)) ??
    (await companies.findByReviewedAlias(normalized));

  if (existing) {
    // Другое написание уже известной компании: запоминаем, но не объединяем
    // ничего само — алиас ждёт проверки человеком.
    const trimmed = rawName.trim();
    if (trimmed !== existing.canonicalName) {
      await companies.addAlias({
        companyId: existing.id,
        alias: trimmed,
        normalized,
        confidence: 1,
      });
    }
    return existing;
  }

  const guess = detectIndustry(rawName);
  const created = await companies.create({
    canonicalName: rawName.trim(),
    normalized,
    industry: guess.industry,
  });

  void trackEvent("company_detected");
  if (guess.industry !== "OTHER") void trackEvent("industry_detected");

  logger().debug(
    { normalized, industry: guess.industry, evidence: guess.evidence },
    "empresa registrada",
  );

  return created;
}
