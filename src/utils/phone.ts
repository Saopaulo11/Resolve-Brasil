/**
 * Нормализация бразильских номеров (§16).
 *
 * Хранить номер нужно в одном виде — иначе «(11) 98765-4321» и
 * «+5511987654321» создадут двух разных пользователей, и человек потеряет
 * доступ к своим делам.
 */

/**
 * Действующие коды DDD. Список закрытый намеренно: опечатка в коде даёт
 * номер, на который OTP никогда не придёт, и пользователь застрянет на входе
 * без объяснения причины.
 */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneParseResult =
  | { ok: true; e164: string; ddd: number; isMobile: boolean }
  | { ok: false; reason: PhoneError };

export type PhoneError =
  | "vazio"
  | "formato"
  | "curto"
  | "longo"
  | "ddd_invalido"
  | "celular_invalido"
  | "fixo_invalido";

/**
 * Текст ошибки для интерфейса — один на все случаи.
 *
 * Разбор различает причины (они нужны тестам и логам), но человеку у поля
 * ввода показывается одна фраза. Разбирать, чем «DDD inválido» отличается от
 * «fixo inválido», — работа не его: он видит поле, которое не приняли, и ему
 * нужно знать, что туда положить. Пример формата стоит рядом, в подсказке под
 * меткой, и он там всегда, а не только после ошибки.
 */
export const PHONE_ERROR_MESSAGE = "Digite um número de celular válido com DDD.";

/** Оставлено для совместимости: все причины ведут к одному тексту. */
export const PHONE_ERROR_MESSAGES: Record<PhoneError, string> = {
  vazio: PHONE_ERROR_MESSAGE,
  formato: PHONE_ERROR_MESSAGE,
  curto: PHONE_ERROR_MESSAGE,
  longo: PHONE_ERROR_MESSAGE,
  ddd_invalido: PHONE_ERROR_MESSAGE,
  celular_invalido: PHONE_ERROR_MESSAGE,
  fixo_invalido: PHONE_ERROR_MESSAGE,
};

/**
 * Приводит ввод к цифрам.
 *
 * Скобки, дефисы, точки, пробелы и неразрывные пробелы человек ставит так,
 * как привык, и как подставляет клавиатура телефона. Плюс и код страны тоже
 * убираются: «+55 11 98765-4321» и «11987654321» — один и тот же номер.
 */
export function normalizeBrazilianPhone(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

export function parseBrazilianPhone(input: string): PhoneParseResult {
  const digits = normalizeBrazilianPhone(input);
  if (digits.length === 0) return { ok: false, reason: "vazio" };

  // Код страны может быть, а может и не быть — принимаем оба варианта.
  let national = digits;
  if (national.length > 11 && national.startsWith("55")) {
    national = national.slice(2);
  }

  // 10 цифр — городской номер, 11 — мобильный.
  //
  // Недобор и перебор разделены намеренно. Человек с лишней цифрой и
  // человек с недостающей исправляют ввод по-разному, а общее «номер
  // неверный» не подсказывает ни тому, ни другому, что именно менять.
  if (national.length < 10) return { ok: false, reason: "curto" };
  if (national.length > 11) return { ok: false, reason: "longo" };

  const ddd = Number.parseInt(national.slice(0, 2), 10);
  if (!VALID_DDD.has(ddd)) return { ok: false, reason: "ddd_invalido" };

  const subscriber = national.slice(2);
  const isMobile = subscriber.length === 9;

  // С 2016 года все мобильные девятизначные и начинаются с 9.
  if (isMobile && !subscriber.startsWith("9")) {
    return { ok: false, reason: "celular_invalido" };
  }

  // У городского номера первой цифрой не бывает 0 — это выход на межгород,
  // и не бывает 1 — за ней закреплены служебные номера вроде 190. Раньше
  // такой номер принимался молча: человек ждал код, а код не мог прийти
  // никогда, и причины он не видел.
  if (!isMobile && /^[01]/.test(subscriber)) {
    return { ok: false, reason: "fixo_invalido" };
  }

  return { ok: true, e164: `+55${national}`, ddd, isMobile };
}

/** Отображение для интерфейса: +55 (11) 98765-4321. */
export function formatBrazilianPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length === 11) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return e164;
}

export { VALID_DDD };
