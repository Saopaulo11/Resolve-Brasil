/**
 * Приватность: сроки хранения и исполнение запросов на удаление (§64, §65).
 *
 *   npm run privacy:retention   — применить сроки хранения
 *   npm run privacy:deletions   — исполнить наступившие запросы на удаление
 *
 * Обе команды запускаются извне, по расписанию. Собственного планировщика
 * внутри процесса нет: на нескольких инстансах он удалял бы одно и то же
 * дважды.
 */
import { loadConfig } from "../config/env";
import { disconnectDb } from "../services/db";
import { executeDueDeletions } from "./deletionService";
import { applyRetention } from "./retentionService";

async function main(): Promise<void> {
  const config = loadConfig();
  const command = process.argv[2];

  try {
    if (command === "retention") {
      const result = await applyRetention();
      console.log(
        `Удалено: документов ${result.documentsDeleted}, ` +
          `дел ${result.casesDeleted}, записей журнала ${result.auditDeleted}`,
      );
      console.log(
        `Сроки: документы ${config.retention.documentDays} дн., ` +
          `дела ${config.retention.caseDays} дн., ` +
          `журнал ${config.retention.auditDays} дн.`,
      );
      return;
    }

    if (command === "deletions") {
      const result = await executeDueDeletions();
      console.log(`Исполнено запросов: ${result.executed}, с ошибкой: ${result.failed}`);
      return;
    }

    console.error("Использование: tsx src/privacy/cli.ts <retention|deletions>");
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
