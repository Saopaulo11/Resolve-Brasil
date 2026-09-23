/**
 * Рассылка наступивших напоминаний (§37, §38).
 *
 *   npm run reminders:dispatch
 *
 * Запускается извне, по расписанию (cron, планировщик платформы).
 * Собственного планировщика внутри процесса нет намеренно: на нескольких
 * инстансах он дублировал бы отправку одному и тому же человеку.
 */
import { loadConfig } from "../config/env";
import { disconnectDb } from "../services/db";
import { dispatchDue } from "./reminderService";

async function main(): Promise<void> {
  loadConfig();

  try {
    const result = await dispatchDue();

    console.log(
      `Отправлено: ${result.sent}, не удалось: ${result.failed}, ` +
        `пропущено: ${result.skipped}, отменено: ${result.cancelled}`,
    );

    if (result.failed > 0 && result.sent === 0) {
      console.log(
        "Ни одно напоминание не доставлено. Если провайдер уведомлений не " +
          "настроен, это ожидаемо: заглушка ничего не отправляет и честно " +
          "об этом сообщает.",
      );
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
