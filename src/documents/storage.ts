import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../config/env";
import { buildSupabaseStorage } from "./supabaseStorage";

/**
 * Приватное хранилище документов (§25).
 *
 * Документы пользователей не бывают публичными. Никакой провайдер не должен
 * отдавать постоянную ссылку: доступ — только через подписанный URL с коротким
 * сроком жизни и проверкой прав на нашей стороне.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Короткоживущая ссылка. ttl в секундах. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

/** Разрешённые типы (§23). Список закрытый: всё остальное отклоняется. */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

export type UploadValidationError =
  | "tipo_nao_permitido"
  | "extensao_nao_confere"
  | "arquivo_muito_grande"
  | "arquivo_vazio";

export const UPLOAD_ERROR_MESSAGES: Record<UploadValidationError, string> = {
  tipo_nao_permitido: "Tipo de arquivo não permitido. Envie PDF, JPG, PNG ou WEBP.",
  extensao_nao_confere: "A extensão do arquivo não corresponde ao seu conteúdo.",
  arquivo_muito_grande: "Arquivo muito grande.",
  arquivo_vazio: "Arquivo vazio.",
};

/**
 * Проверка загрузки (§25).
 *
 * Расширение и MIME проверяются вместе: по отдельности каждый подделывается,
 * а расхождение между ними — сам по себе признак попытки обойти фильтр.
 */
export function validateUpload(input: {
  filename: string;
  mimeType: string;
  size: number;
}): UploadValidationError | null {
  const config = loadConfig();

  if (input.size <= 0) return "arquivo_vazio";
  if (input.size > config.storage.maxFileSizeBytes) return "arquivo_muito_grande";

  const allowedExtensions = ALLOWED_MIME_TYPES[input.mimeType];
  if (!allowedExtensions) return "tipo_nao_permitido";

  const extension = path.extname(input.filename).toLowerCase();
  if (!allowedExtensions.includes(extension)) return "extensao_nao_confere";

  return null;
}

/** Ключ хранения. Имя файла пользователя в путь не попадает. */
export function buildStorageKey(caseId: string, mimeType: string): string {
  const extension = ALLOWED_MIME_TYPES[mimeType]?.[0] ?? ".bin";
  return `cases/${caseId}/${randomUUID()}${extension}`;
}

export function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Кладёт файлы в ./storage — каталог в .gitignore. Подписанная ссылка ведёт
 * на наш же маршрут, который проверяет права: даже локально документ не
 * отдаётся статикой.
 */
export class MockStorageProvider implements StorageProvider {
  readonly name = "mock";
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? path.join(process.cwd(), "storage"));
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Защита от ../: ключ не должен уводить за пределы каталога.
    if (!full.startsWith(this.root + path.sep)) {
      throw new Error("Некорректный ключ хранения");
    }
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  async signedUrl(key: string, _ttlSeconds: number): Promise<string> {
    // Локально отдаём через собственный маршрут с проверкой прав (PHASE 5).
    return `/documentos/${encodeURIComponent(key)}`;
  }
}

let instance: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (instance) return instance;

  const config = loadConfig();
  if (config.storage.provider === "mock") {
    if (config.isProduction) {
      throw new Error(
        "MockStorageProvider недопустим в production: документы попадут на диск " +
          "инстанса и исчезнут при перезапуске. Задайте STORAGE_PROVIDER.",
      );
    }
    instance = new MockStorageProvider(config.storage.localRoot ?? undefined);
    return instance;
  }

  if (config.storage.provider === "supabase") {
    instance = buildSupabaseStorage();
    return instance;
  }

  throw new Error(
    `STORAGE_PROVIDER=${config.storage.provider}: провайдер не реализован. ` +
      "Доступны: supabase, mock (только для разработки).",
  );
}

export function resetStorageProviderCache(): void {
  instance = null;
}
