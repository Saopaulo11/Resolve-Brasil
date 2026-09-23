/**
 * Что вообще может считаться официальным источником (§29, §30).
 *
 * Проверка домена — структурный запрет, а не пожелание в промпте. Модель
 * физически не может подсунуть блог вместо gov.br: несоответствующий адрес
 * не попадает в базу и, значит, никогда не попадает в запрос.
 *
 * Список закрытый:
 *   .gov.br — исполнительная власть всех уровней, включая Procon штатов
 *   .jus.br — судебная власть
 *   .leg.br — законодательная власть
 */
const ALLOWED_SUFFIXES = [".gov.br", ".jus.br", ".leg.br"];
const ALLOWED_EXACT = ["gov.br", "jus.br", "leg.br"];

export type SourceUrlError = "protocolo" | "dominio" | "formato";

export const SOURCE_URL_MESSAGES: Record<SourceUrlError, string> = {
  protocolo: "A fonte precisa usar HTTPS.",
  dominio: "A fonte precisa estar em um domínio oficial (.gov.br, .jus.br ou .leg.br).",
  formato: "Endereço inválido.",
};

export function validateSourceUrl(raw: string): SourceUrlError | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "formato";
  }

  // http допускает подмену содержимого по пути — для источника, на который
  // человек будет опираться, этого достаточно, чтобы отказать.
  if (url.protocol !== "https:") return "protocolo";

  const host = url.hostname.toLowerCase();
  if (ALLOWED_EXACT.includes(host)) return null;
  if (ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;

  return "dominio";
}

export function isOfficialSourceUrl(raw: string): boolean {
  return validateSourceUrl(raw) === null;
}

export { ALLOWED_SUFFIXES, ALLOWED_EXACT };
