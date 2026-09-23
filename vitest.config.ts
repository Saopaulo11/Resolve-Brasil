import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Документы тестов уходят во временный каталог и удаляются после
    // прогона: иначе они копятся в рабочем каталоге без предела.
    globalSetup: ["tests/setup/storage.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
