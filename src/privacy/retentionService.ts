import { loadConfig } from "../config/env";
import { storageProvider } from "../documents/storage";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";

/**
 * Применение сроков хранения (§65).
 *
 * Документы не хранятся вечно «на всякий случай»: каждый лишний месяц
 * хранения квитанции с чужим CPF — это месяц риска без цели. Дела живут
 * дольше: по ним человек возвращается спустя год. Журнал доступа живёт
 * дольше всех — он нужен ровно для разбирательств задним числом.
 */
export type RetentionResult = {
  documentsDeleted: number;
  casesDeleted: number;
  auditDeleted: number;
};

const BATCH = 200;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function applyRetention(): Promise<RetentionResult> {
  const config = loadConfig();
  const { documents, cases, audit } = stores();

  const result: RetentionResult = {
    documentsDeleted: 0,
    casesDeleted: 0,
    auditDeleted: 0,
  };

  // Документы: сначала файл из хранилища, потом запись. Обратный порядок
  // оставил бы файлы без ссылок — то есть навсегда.
  for (const document of await documents.listOlderThan(
    daysAgo(config.retention.documentDays),
    BATCH,
  )) {
    try {
      await storageProvider().remove(document.storageKey);
      await documents.hardDelete(document.id);
      result.documentsDeleted += 1;
    } catch (error) {
      logger().warn({ err: error, documentId: document.id }, "falha ao remover documento");
    }
  }

  // Дела считаются от закрытия, а не от создания: открытое дело живёт,
  // сколько нужно человеку.
  for (const item of await cases.listClosedBefore(
    daysAgo(config.retention.caseDays),
    BATCH,
  )) {
    try {
      for (const document of await documents.listForCase(item.id)) {
        await storageProvider().remove(document.storageKey);
        await documents.hardDelete(document.id);
        result.documentsDeleted += 1;
      }
      await cases.deleteCase(item.id);
      result.casesDeleted += 1;
    } catch (error) {
      logger().warn({ err: error, caseId: item.id }, "falha ao remover caso");
    }
  }

  result.auditDeleted = await audit.deleteOlderThan(daysAgo(config.retention.auditDays));

  return result;
}
