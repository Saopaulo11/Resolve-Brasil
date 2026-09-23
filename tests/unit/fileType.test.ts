import { describe, expect, it } from "vitest";

import { declaredMatchesActual, detectFileType } from "../../src/documents/fileType";

/** Минимальные валидные заголовки — ровно сигнатура и немного данных. */
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

describe("определение типа по содержимому", () => {
  it("узнаёт разрешённые форматы", () => {
    expect(detectFileType(PDF)).toBe("application/pdf");
    expect(detectFileType(JPEG)).toBe("image/jpeg");
    expect(detectFileType(PNG)).toBe("image/png");
    expect(detectFileType(WEBP)).toBe("image/webp");
  });

  it("не узнаёт исполняемый файл", () => {
    // ELF — именно то, что пытаются загрузить под видом квитанции.
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expect(detectFileType(elf)).toBeNull();
  });

  it("не узнаёт HTML со скриптом", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
    expect(detectFileType(html)).toBeNull();
  });

  it("не путает RIFF без метки WEBP", () => {
    // WAV — тот же контейнер RIFF, но не картинка.
    const wav = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WAVEfmt ", "latin1"),
    ]);
    expect(detectFileType(wav)).toBeNull();
  });

  it("не падает на слишком коротком файле", () => {
    expect(detectFileType(Buffer.from([0x25]))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});

describe("сверка заявленного типа с настоящим", () => {
  it("пропускает совпадение", () => {
    expect(declaredMatchesActual("application/pdf", "application/pdf")).toBe(true);
  });

  it("принимает устаревшие написания JPEG", () => {
    // image/jpg и image/pjpeg шлют браузеры и почтовые клиенты — это тот же формат.
    expect(declaredMatchesActual("image/jpg", "image/jpeg")).toBe(true);
    expect(declaredMatchesActual("image/pjpeg", "image/jpeg")).toBe(true);
  });

  it("ловит подмену", () => {
    // Классика: исполняемый файл с заявленным application/pdf.
    expect(declaredMatchesActual("application/pdf", "image/png")).toBe(false);
    expect(declaredMatchesActual("image/png", "application/pdf")).toBe(false);
  });
});
