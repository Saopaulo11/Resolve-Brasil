import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 берёт строку подключения отсюда для migrate/introspect, а рантайм —
 * из драйвер-адаптера в src/services/db.ts. Двух мест не избежать: CLI
 * работает до старта приложения и нашей конфигурации не видит.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
