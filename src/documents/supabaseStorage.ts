import { loadConfig } from "../config/env";
import type { StorageProvider } from "./storage";

/**
 * Приватное хранилище документов на Supabase Storage (§25).
 *
 * Бакет приватный: у файла нет и не может быть постоянного адреса. Наружу
 * документ уходит только через наш маршрут, который проверяет владельца и
 * пишет обращение в журнал, — подписанная ссылка здесь есть, но в обычном
 * пути выдачи она не участвует.
 *
 * Ключ доступа — служебный ключ проекта. Он читается один раз при сборке
 * провайдера, никуда не копируется и не попадает ни в одно сообщение об
 * ошибке: текст ответа хранилища перед показом обрезается и не содержит
 * заголовков (§6, §41).
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";

  constructor(
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly secretKey: string,
  ) {}

  private url(...parts: string[]): string {
    // Ключ хранения собираем мы сами (buildStorageKey), имени файла в нём
    // нет. Кодирование всё равно посегментное: ключ не должен уметь выйти
    // за пределы бакета через ../ или собственный слэш.
    return `${this.endpoint.replace(/\/+$/, "")}/storage/v1/${parts.join("/")}`;
  }

  private objectUrl(key: string): string {
    const caminho = key
      .split("/")
      .filter((segmento) => segmento.length > 0)
      .map(encodeURIComponent)
      .join("/");
    return this.url("object", encodeURIComponent(this.bucket), caminho);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.secretKey}`, ...extra };
  }

  /**
   * Ошибка хранилища без содержимого ответа.
   *
   * Сообщение доходит до страницы отказа и до журнала, а в теле ответа
   * хранилища встречается и ключ, и путь. Наружу идёт код и операция —
   * этого хватает, чтобы понять, что случилось.
   */
  private falha(operacao: string, status: number): Error {
    return new Error(`Supabase Storage: ${operacao} respondeu HTTP ${status}`);
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<void> {
    const response = await fetch(this.objectUrl(key), {
      method: "POST",
      headers: this.headers({
        "content-type": mimeType,
        // Ключ уникален по построению. Перезапись означала бы столкновение,
        // и молча затирать чужой документ нельзя.
        "x-upsert": "false",
      }),
      body: new Uint8Array(data),
    });

    if (!response.ok) throw this.falha("envio", response.status);
  }

  async get(key: string): Promise<Buffer> {
    const response = await fetch(this.objectUrl(key), { headers: this.headers() });
    if (!response.ok) throw this.falha("leitura", response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    const response = await fetch(this.objectUrl(key), {
      method: "DELETE",
      headers: this.headers(),
    });

    // Удаление отсутствующего — не ошибка: сроки хранения и запрос на
    // удаление данных могут дойти до одного файла дважды.
    if (!response.ok && response.status !== 404) {
      throw this.falha("remoção", response.status);
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const caminho = key
      .split("/")
      .filter((segmento) => segmento.length > 0)
      .map(encodeURIComponent)
      .join("/");

    const response = await fetch(
      this.url("object", "sign", encodeURIComponent(this.bucket), caminho),
      {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ expiresIn: ttlSeconds }),
      },
    );

    if (!response.ok) throw this.falha("assinatura", response.status);

    const corpo = (await response.json()) as { signedURL?: unknown };
    if (typeof corpo.signedURL !== "string" || corpo.signedURL.length === 0) {
      throw new Error("Supabase Storage: assinatura sem endereço");
    }

    return `${this.endpoint.replace(/\/+$/, "")}/storage/v1${corpo.signedURL}`;
  }
}

/**
 * Сборка провайдера из конфигурации.
 *
 * Не хватает переменной — отказ называет её по имени. Провайдер, собранный
 * наполовину, падал бы на первой же загрузке, и причину пришлось бы искать
 * в чужих сообщениях об HTTP.
 */
export function buildSupabaseStorage(): SupabaseStorageProvider {
  const { storage } = loadConfig();

  const faltando: string[] = [];
  if (!storage.endpoint) faltando.push("STORAGE_ENDPOINT");
  if (!storage.bucket) faltando.push("STORAGE_BUCKET");
  if (!storage.secretKey) faltando.push("STORAGE_SECRET_KEY");

  if (faltando.length > 0) {
    throw new Error(
      `STORAGE_PROVIDER=supabase: не заданы ${faltando.join(", ")}. См. .env.example.`,
    );
  }

  return new SupabaseStorageProvider(
    storage.endpoint as string,
    storage.bucket as string,
    storage.secretKey as string,
  );
}
