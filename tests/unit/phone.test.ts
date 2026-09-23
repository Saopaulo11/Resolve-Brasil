import { describe, expect, it } from "vitest";

import {
  formatBrazilianPhone,
  parseBrazilianPhone,
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

  it("отклоняет слишком короткий и слишком длинный ввод", () => {
    expect(parseBrazilianPhone("119876").ok).toBe(false);
    expect(parseBrazilianPhone("119876543219999").ok).toBe(false);
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
