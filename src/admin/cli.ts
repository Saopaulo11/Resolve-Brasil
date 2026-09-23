/**
 * Создание администратора (§51).
 *
 *   npm run admin:create -- admin@exemplo.com OWNER
 *
 * Пароль не принимается аргументом намеренно: аргументы командной строки
 * видны в истории оболочки и в списке процессов. Команда генерирует
 * стойкий пароль, печатает его один раз и хранит только хеш.
 */
import { randomBytes } from "node:crypto";

import { loadConfig } from "../config/env";
import { disconnectDb } from "../services/db";
import { stores } from "../users/storeRegistry";
import { hashPassword } from "./password";
import { ROLE_LABELS } from "./rbac";
import type { AdminRole } from "../generated/prisma/enums";

const ROLES: readonly AdminRole[] = ["VIEWER", "SUPPORT", "ANALYST", "ADMIN", "OWNER"];

/** Пароль из случайных байтов: человек его не придумывает и не повторяет. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main(): Promise<void> {
  loadConfig();

  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3]?.trim().toUpperCase() as AdminRole | undefined;

  if (!email || !email.includes("@")) {
    console.error("Использование: npm run admin:create -- <email> <ROLE>");
    console.error(`Роли: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (!role || !ROLES.includes(role)) {
    console.error(`Неизвестная роль. Допустимые: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { admins } = stores();

    if (await admins.findByEmail(email)) {
      console.error(`Администратор ${email} уже существует.`);
      process.exitCode = 1;
      return;
    }

    const password = generatePassword();
    await admins.create({ email, passwordHash: await hashPassword(password), role });

    console.log(`Создан администратор: ${email}`);
    console.log(`Роль: ${role} (${ROLE_LABELS[role]})`);
    console.log("");
    console.log(`Пароль: ${password}`);
    console.log("");
    console.log(
      "Пароль показан один раз и нигде не сохранён в открытом виде. " +
        "Запишите его в менеджер паролей сейчас.",
    );
  } finally {
    await disconnectDb();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
