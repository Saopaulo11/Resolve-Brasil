/**
 * Внутренний аналитический отчёт (§58).
 *
 *   npm run analytics:report
 *
 * Команда, а не страница, намеренно: веб-дашборд без авторизации админа
 * означал бы открытый доступ к агрегатам, а авторизация — это PHASE 10.
 * Отчёт печатается тому, кто уже имеет доступ к серверу.
 */
import { loadConfig } from "../config/env";
import { disconnectDb } from "../services/db";
import { companyProfile, internalReport, type GroupedResult } from "./aggregation";

function printGroup(title: string, group: GroupedResult): void {
  console.log(`\n${title}`);

  if (group.buckets.length === 0) {
    console.log("  (нет групп, прошедших порог)");
  }

  for (const bucket of group.buckets) {
    console.log(`  ${bucket.key.padEnd(32)} ${bucket.count}`);
  }

  if (group.suppressedGroups > 0) {
    // Скрытое не молчит: иначе читатель сложит доли до ста процентов там,
    // где это неверно.
    console.log(
      `  скрыто групп: ${group.suppressedGroups} ` +
        `(${group.suppressedCount} дел, меньше ${group.minGroupSize} в группе)`,
    );
  }
}

async function main(): Promise<void> {
  loadConfig();

  try {
    const company = process.argv[2];

    if (company) {
      const profile = await companyProfile(company);
      console.log(`Empresa: ${profile.company}`);
      console.log(`Casos na amostra: ${profile.sampleSize}`);

      if (!profile.available) {
        console.log(profile.reason);
        return;
      }

      console.log(`Período: ${profile.period?.from} — ${profile.period?.to}`);
      console.log(`Mediana de dias até a resolução: ${profile.medianResolutionDays ?? "—"}`);
      if (profile.byCategory) printGroup("Por categoria", profile.byCategory);
      return;
    }

    const report = await internalReport();

    console.log(`Отчёт на ${report.generatedAt}`);
    console.log(`Минимальный размер группы: ${report.minGroupSize}`);
    console.log("");
    console.log(`Всего дел:        ${report.summary.total}`);
    console.log(`Решено:           ${report.summary.resolved}`);
    console.log(`Не решено:        ${report.summary.unresolved}`);
    console.log(`Эскалировано:     ${report.summary.escalated}`);
    console.log(
      `Доля эскалаций:   ${
        report.summary.escalationRate === null
          ? "— (выборка меньше порога)"
          : `${Math.round(report.summary.escalationRate * 100)}%`
      }`,
    );
    console.log(
      `Медиана решения:  ${
        report.summary.medianResolutionDays === null
          ? "— (решённых меньше порога)"
          : `${report.summary.medianResolutionDays} дн.`
      }`,
    );

    printGroup("По категориям", report.byCategory);
    printGroup("По отраслям", report.byIndustry);
    printGroup("По способу оплаты", report.byPaymentMethod);
    printGroup("По диапазону суммы", report.byAmountBucket);
    printGroup("По месяцам", report.byMonth);
    printGroup("По штатам", report.byState);

    console.log(
      "\nЭто дела, зарегистрированные в Resolve Brasil, а не выборка по " +
        "стране. Представлять их как статистику по Бразилии нельзя (§61).",
    );
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
