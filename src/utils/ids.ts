import { randomInt } from "node:crypto";

/**
 * Публичный идентификатор дела (§21).
 *
 * Не последовательный намеренно: по номеру RB-000123 видно, сколько дел в
 * системе, и соседние номера легко перебрать. Здесь — случайные символы из
 * алфавита без 0/O и 1/I/L, чтобы номер можно было продиктовать по телефону
 * и не получить чужое дело из-за похожих знаков.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 6;

export function generatePublicCaseId(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `RB-${out}`;
}

export function isValidPublicCaseId(value: string): boolean {
  return new RegExp(`^RB-[${ALPHABET}]{${LENGTH}}$`).test(value);
}

export { ALPHABET as PUBLIC_ID_ALPHABET, LENGTH as PUBLIC_ID_LENGTH };
