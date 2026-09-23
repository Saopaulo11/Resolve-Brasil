/**
 * Импорт и проверка официальных источников (§29, §32).
 *
 *   npm run sources:import   — добавить кандидатов из sources/candidates.json
 *   npm run sources:verify   — открыть каждый адрес и проставить дату проверки
 *
 * Разнесено намеренно. Импорт ничего не подтверждает: он лишь заводит
 * записи. Подтверждением считается только успешная проверка, и запускать её
 * нужно там, где есть доступ в сеть.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../config/env";
import { disconnectDb } from "../services/db";
import { SOURCE_URL_MESSAGES, type SourceUrlError } from "./policy";
import { importCandidates, verifyAll } from "./sourceService";
import type { UpsertSourceInput } from "./sourceStore";

const CANDIDATES_FILE = path.resolve(process.cwd(), "sources/candidates.json");

async function readCandidates(): Promise<UpsertSourceInput[]> {
  const raw = await readFile(CANDIDATES_FILE, "utf8");
  const parsed = JSON.parse(raw) as { sources?: unknown };

  if (!Array.isArray(parsed.sources)) {
    throw new Error("sources/candidates.json: ожидается поле \"sources\" с массивом.");
  }

  return parsed.sources.map((item) => {
    const source = item as Record<string, unknown>;
    if (
      typeof source.organization !== "string" ||
      typeof source.title !== "string" ||
      typeof source.url !== "string"
    ) {
      throw new Error("Каждый источник обязан иметь organization, title и url.");
    }
    return {
      organization: source.organization,
      title: source.title,
      url: source.url,
      category: typeof source.category === "string" ? source.category : null,
    };
  });
}

async function runImport(): Promise<void> {
  const candidates = await readCandidates();
  const result = await importCandidates(candidates);

  console.log(`Добавлено: ${result.added}, уже было: ${result.skipped}`);

  for (const rejected of result.rejected) {
    const reason = SOURCE_URL_MESSAGES[rejected.reason as SourceUrlError] ?? rejected.reason;
    console.log(`Отклонено: ${rejected.url} — ${reason}`);
  }

  console.log(
    "\nНичего из добавленного пока не используется: запустите " +
      "`npm run sources:verify`, чтобы подтвердить адреса.",
  );
}

async function runVerify(): Promise<void> {
  const result = await verifyAll();

  for (const outcome of result.outcomes) {
    const mark = outcome.ok ? "OK " : "FALHOU";
    console.log(`${mark}  ${outcome.url}${outcome.reason ? ` — ${outcome.reason}` : ""}`);
  }

  console.log(`\nПодтверждено: ${result.verified}, недоступно: ${result.failed}`);

  if (result.verified === 0) {
    console.log(
      "Ни один источник не подтверждён. План действий будет честно писать, " +
        "что процедуру подтвердить не удалось — это ожидаемое поведение, а не сбой.",
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  loadConfig();

  try {
    if (command === "import") {
      await runImport();
    } else if (command === "verify") {
      await runVerify();
    } else {
      console.error("Использование: tsx src/sources/cli.ts <import|verify>");
      process.exitCode = 1;
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
