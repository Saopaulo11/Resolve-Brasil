/**
 * Определение типа файла по содержимому (§25).
 *
 * MIME-тип и расширение приходят от клиента и подделываются тривиально:
 * достаточно переименовать файл и подставить свой Content-Type. Поэтому
 * решающим считается не заявленный тип, а сигнатура в первых байтах.
 *
 * Это не защита от всего: файл с верной сигнатурой может содержать что
 * угодно дальше. Но она отсекает самый дешёвый обход — исполняемый файл,
 * названный comprovante.pdf.
 */
export type DetectedType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

type Signature = {
  type: DetectedType;
  /** Смещение → ожидаемые байты. */
  parts: Array<{ offset: number; bytes: number[] }>;
};

const SIGNATURES: Signature[] = [
  // "%PDF-"
  { type: "application/pdf", parts: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }] },
  // SOI + маркер JFIF/EXIF
  { type: "image/jpeg", parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  {
    type: "image/png",
    parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  // RIFF....WEBP — контейнер RIFF с меткой формата на восьмом байте.
  {
    type: "image/webp",
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

function matches(data: Buffer, signature: Signature): boolean {
  return signature.parts.every((part) =>
    part.bytes.every((byte, index) => data[part.offset + index] === byte),
  );
}

/** Тип по содержимому или null, если сигнатура не распознана. */
export function detectFileType(data: Buffer): DetectedType | null {
  for (const signature of SIGNATURES) {
    if (matches(data, signature)) return signature.type;
  }
  return null;
}

/**
 * Совпадает ли заявленный тип с настоящим.
 *
 * JPEG отдельно: браузеры и почтовые клиенты шлют его и как image/jpg,
 * и как image/pjpeg — это одно и то же, и отказывать тут не за что.
 */
export function declaredMatchesActual(declared: string, actual: DetectedType): boolean {
  if (declared === actual) return true;
  if (actual === "image/jpeg") return declared === "image/jpg" || declared === "image/pjpeg";
  return false;
}

export { SIGNATURES };
