import { describe, expect, it } from "vitest";

import {
  formatBrazilianPhone,
  parseBrazilianPhone,
  normalizeBrazilianPhone,
  PHONE_ERROR_MESSAGES,
} from "../../src/utils/phone";

describe("нормализация бразильских телефонов", () => {
  it("приводит разные записи одного номера к одному виду", () => {
    // Смысл нормализации: иначе один человек заведёт несколько учётных
    // записей и потеряет доступ к своим делам.
    const variants = [
      "11987654321",
      "(11) 98765-4321",
      "+55 11 98765-4321",
      "5511987654321",
      " 11 9 8765 4321 ",
    ];

    for (const variant of variants) {
      const result = parseBrazilianPhone(variant);
      expect(result.ok, variant).toBe(true);
      if (result.ok) expect(result.e164).toBe("+5511987654321");
    }
  });

  it("принимает городской номер из десяти цифр", () => {
    const result = parseBrazilianPhone("1133334444");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.e164).toBe("+551133334444");
      expect(result.isMobile).toBe(false);
    }
  });

  it("отклоняет несуществующий DDD", () => {
    // 20 нет среди действующих кодов: OTP на такой номер не дойдёт никогда.
    const result = parseBrazilianPhone("20987654321");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ddd_invalido");
  });

  it("требует девятку в начале мобильного номера", () => {
    const result = parseBrazilianPhone("11887654321");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("celular_invalido");
  });

  it("различает недобор и перебор цифр", () => {
    // Это две разные ошибки ввода, и человек исправляет их по-разному.
    const curto = parseBrazilianPhone("119876");
    expect(curto.ok).toBe(false);
    if (!curto.ok) expect(curto.reason).toBe("curto");

    const longo = parseBrazilianPhone("119876543219999");
    expect(longo.ok).toBe(false);
    if (!longo.ok) expect(longo.reason).toBe("longo");
  });

  it("человеку показывает одну фразу, какой бы ни была причина", () => {
    // Причины различаются внутри — для тестов и логов. У поля ввода человек
    // видит одно понятное требование, а не разбор своего ввода.
    const entradas = ["120997847612", "119", "20987654321", "11887654321", ""];

    for (const entrada of entradas) {
      const result = parseBrazilianPhone(entrada);
      expect(result.ok, entrada).toBe(false);
      if (!result.ok) {
        expect(PHONE_ERROR_MESSAGES[result.reason], entrada).toBe(
          "Digite um número de celular válido com DDD.",
        );
      }
    }
  });

  it("принимает номер в любой привычной записи", () => {
    // Скобки, дефисы, пробелы и код страны человек ставит как привык — и как
    // подставляет клавиатура телефона.
    const variantes = [
      "(11) 98765-4321",
      "11987654321",
      "+55 11 98765-4321",
      "+5511987654321",
      "55 11 98765.4321",
      "  11 9 8765 4321  ",
    ];

    for (const variante of variantes) {
      const result = parseBrazilianPhone(variante);
      expect(result.ok, variante).toBe(true);
      if (result.ok) {
        expect(result.e164, variante).toBe("+5511987654321");
        expect(result.isMobile, variante).toBe(true);
      }
    }
  });

  it("нормализация оставляет только цифры", () => {
    expect(normalizeBrazilianPhone("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(normalizeBrazilianPhone("11 9.8765 4321")).toBe("11987654321");
  });

  it("DDD не может начинаться с нуля", () => {
    // 01 нет среди действующих кодов: такой номер не существует.
    const result = parseBrazilianPhone("01987654321");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ddd_invalido");
  });

  it("отклоняет городской номер, до которого код не дойдёт", () => {
    // 0 после DDD — выход на межгород, 1 — служебные номера. Раньше такой
    // номер принимался, и человек ждал код, которого не могло быть.
    for (const numero of ["1209978476", "1119978476"]) {
      const result = parseBrazilianPhone(numero);
      expect(result.ok, numero).toBe(false);
      if (!result.ok) expect(result.reason).toBe("fixo_invalido");
    }
  });

  it("отличает пустой ввод от неверного формата", () => {
    const empty = parseBrazilianPhone("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe("vazio");
  });

  it("форматирует номер для показа", () => {
    expect(formatBrazilianPhone("+5511987654321")).toBe("+55 (11) 98765-4321");
    expect(formatBrazilianPhone("+551133334444")).toBe("+55 (11) 3333-4444");
  });
});
