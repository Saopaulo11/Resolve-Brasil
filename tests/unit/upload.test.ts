import { describe, expect, it } from "vitest";

import { buildStorageKey, validateUpload } from "../../src/documents/storage";

describe("проверка загружаемых документов", () => {
  it("пропускает разрешённые типы", () => {
    expect(
      validateUpload({ filename: "nota.pdf", mimeType: "application/pdf", size: 1024 }),
    ).toBeNull();
    expect(
      validateUpload({ filename: "pix.JPG", mimeType: "image/jpeg", size: 1024 }),
    ).toBeNull();
  });

  it("отклоняет неразрешённый тип", () => {
    expect(
      validateUpload({
        filename: "script.svg",
        mimeType: "image/svg+xml",
        size: 512,
      }),
    ).toBe("tipo_nao_permitido");
  });

  it("ловит расхождение расширения и MIME", () => {
    // По отдельности подделывается и то и другое; расхождение между ними —
    // само по себе признак попытки обойти фильтр.
    expect(
      validateUpload({
        filename: "malicioso.exe",
        mimeType: "application/pdf",
        size: 512,
      }),
    ).toBe("extensao_nao_confere");
  });

  it("отклоняет пустой и слишком большой файл", () => {
    expect(
      validateUpload({ filename: "a.pdf", mimeType: "application/pdf", size: 0 }),
    ).toBe("arquivo_vazio");
    expect(
      validateUpload({
        filename: "a.pdf",
        mimeType: "application/pdf",
        size: 50 * 1024 * 1024,
      }),
    ).toBe("arquivo_muito_grande");
  });

  it("не переносит имя файла пользователя в ключ хранения", () => {
    // Иначе «../../etc/passwd.pdf» окажется частью пути.
    const key = buildStorageKey("11111111-1111-4111-8111-111111111111", "application/pdf");
    expect(key).toMatch(/^cases\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.pdf$/);
  });
});
