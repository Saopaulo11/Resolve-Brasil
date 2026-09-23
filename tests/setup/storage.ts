import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Временный каталог для документов на время прогона тестов.
 *
 * Без него заглушка хранилища писала файлы в рабочий каталог проекта и
 * никогда их не убирала: каждый `npm test` оставлял десятки файлов, а за
 * сотню прогонов набирались мегабайты — в контейнере с ограниченным
 * диском это кончается нехваткой места на ровном месте.
 */
let root: string | null = null;

export function setup(): void {
  root = mkdtempSync(path.join(tmpdir(), "resolve-brasil-testes-"));
  process.env.STORAGE_LOCAL_ROOT = root;
}

export function teardown(): void {
  if (!root) return;
  rmSync(root, { recursive: true, force: true });
  root = null;
  delete process.env.STORAGE_LOCAL_ROOT;
}
