import { loadConfig } from "../config/env";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import { validateSourceUrl } from "./policy";
import type { SourceRecord, UpsertSourceInput } from "./sourceStore";

/**
 * Официальные источники в работе (§29–§32).
 */

/** Сколько источников максимум уходит модели за раз. */
const MAX_SOURCES_PER_CALL = 20;

function staleBefore(): Date {
  const days = loadConfig().sources.maxAgeDays;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Источники, пригодные к использованию.
 *
 * Непроверенный или давно не проверявшийся источник не возвращается вообще.
 * Пустой ответ — нормальное состояние: план действий тогда честно скажет,
 * что процедуру подтвердить не удалось (§32), и это лучше ссылки, которую
 * никто не открывал полгода.
 */
export async function usableSources(): Promise<SourceRecord[]> {
  return stores().sources.listUsable(staleBefore(), MAX_SOURCES_PER_CALL);
}

/** Тот же список в виде, который принимает провайдер модели. */
export async function usableSourceOptions(): Promise<
  Array<{ organization: string; title: string; url: string }>
> {
  const sources = await usableSources();
  return sources.map((source) => ({
    organization: source.organization,
    title: source.title,
    url: source.url,
  }));
}

export type ImportResult = {
  added: number;
  skipped: number;
  rejected: Array<{ url: string; reason: string }>;
};

/**
 * Добавление источников-кандидатов.
 *
 * Добавленный источник НЕ считается проверенным: active остаётся false,
 * lastVerifiedAt пустым. Пока его не откроет проверка, он не существует
 * ни для пользователя, ни для модели.
 */
export async function importCandidates(
  candidates: UpsertSourceInput[],
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, skipped: 0, rejected: [] };
  const { sources } = stores();

  for (const candidate of candidates) {
    const error = validateSourceUrl(candidate.url);
    if (error) {
      result.rejected.push({ url: candidate.url, reason: error });
      continue;
    }

    const existing = await sources.findByUrl(candidate.url);
    if (existing) {
      result.skipped += 1;
      continue;
    }

    await sources.upsert(candidate);
    result.added += 1;
  }

  return result;
}

export type VerificationOutcome = {
  url: string;
  ok: boolean;
  status: number | null;
  reason: string | null;
};

/**
 * Проверка одного адреса.
 *
 * Открывается ли страница вообще — это всё, что можно проверить машинно.
 * Соответствие содержимого заявленному названию машина не подтвердит, и
 * выдавать доступность за подтверждение содержания нельзя: поэтому
 * добавление источника остаётся действием человека.
 */
export async function checkUrl(url: string): Promise<VerificationOutcome> {
  const timeout = loadConfig().sources.verifyTimeoutMs;

  const policyError = validateSourceUrl(url);
  if (policyError) return { url, ok: false, status: null, reason: policyError };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "ResolveBrasil/1.0 (verificacao de fonte oficial)" },
    });

    // Редирект на другой домен — не подтверждение: адрес мог быть продан
    // или переехать за пределы официальной зоны.
    const finalError = validateSourceUrl(response.url || url);
    if (finalError) {
      return { url, ok: false, status: response.status, reason: `redirecionou: ${finalError}` };
    }

    return {
      url,
      ok: response.ok,
      status: response.status,
      reason: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export type VerifyAllResult = {
  verified: number;
  failed: number;
  outcomes: VerificationOutcome[];
};

/** Проверка всех источников. Запускается там, где есть доступ в сеть. */
export async function verifyAll(): Promise<VerifyAllResult> {
  const { sources } = stores();
  const all = await sources.listAll();

  const result: VerifyAllResult = { verified: 0, failed: 0, outcomes: [] };
  const now = new Date();

  for (const source of all) {
    const outcome = await checkUrl(source.url);
    result.outcomes.push(outcome);

    if (outcome.ok) {
      await sources.markVerified(source.id, now);
      result.verified += 1;
    } else {
      await sources.markUnavailable(source.id, outcome.reason ?? "indisponível");
      result.failed += 1;
      logger().warn(
        { url: source.url, reason: outcome.reason },
        "fonte oficial não pôde ser verificada",
      );
    }
  }

  return result;
}

export { MAX_SOURCES_PER_CALL };
