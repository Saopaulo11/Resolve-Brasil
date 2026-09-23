import { describe, expect, it } from "vitest";

import {
  fieldsFromFacts,
  parseAmount,
  parseDate,
  parsePaymentMethod,
} from "../../src/cases/factFields";

/**
 * §26. Разбор подтверждённых фактов в поля дела.
 *
 * Главное здесь — умение отказываться: наполовину разобранная сумма
 * выглядит как настоящая и уходит в аналитику, а проверить её потом нечем.
 */
describe("сумма", () => {
  it("читает бразильский формат", () => {
    expect(parseAmount("R$ 1.299,00")).toBe("1299.00");
    expect(parseAmount("249,90")).toBe("249.90");
    expect(parseAmount("R$ 12.345,67")).toBe("12345.67");
  });

  it("читает формат без разделителей", () => {
    expect(parseAmount("1299")).toBe("1299.00");
    expect(parseAmount("1299.50")).toBe("1299.50");
  });

  it("точка с тремя цифрами — это тысячи", () => {
    // «1.299» в Бразилии это тысяча двести девяносто девять, а не 1,299.
    expect(parseAmount("1.299")).toBe("1299.00");
  });

  it("отказывается от непонятного", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("не знаю")).toBeNull();
    expect(parseAmount("1,2,3")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    // Минус не отбрасывается молча: «-50» не равно «50».
    expect(parseAmount("-50")).toBeNull();
  });

  it("отказывается от абсурдной величины", () => {
    expect(parseAmount("999999999999")).toBeNull();
  });
});

describe("дата", () => {
  it("читает бразильский порядок", () => {
    expect(parseDate("10/09/2026")?.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(parseDate("2/3/2026")?.toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("читает ISO", () => {
    expect(parseDate("2026-09-10")?.toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("двузначный год — это двадцать первый век", () => {
    expect(parseDate("10/09/26")?.getUTCFullYear()).toBe(2026);
  });

  it("отказывается от несуществующей даты", () => {
    // 31 февраля молча превращается в 3 марта — такую дату принимать нельзя.
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("32/01/2026")).toBeNull();
    expect(parseDate("10/13/2026")).toBeNull();
  });

  it("отказывается от мусора", () => {
    expect(parseDate("ontem")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("способ оплаты", () => {
  it("узнаёт основные способы", () => {
    expect(parsePaymentMethod("Pix")).toBe("PIX");
    expect(parsePaymentMethod("PIX")).toBe("PIX");
    expect(parsePaymentMethod("Cartão de crédito")).toBe("CARTAO_CREDITO");
    expect(parsePaymentMethod("cartao de debito")).toBe("CARTAO_DEBITO");
    expect(parsePaymentMethod("Boleto bancário")).toBe("BOLETO");
  });

  it("не угадывает, когда не знает", () => {
    expect(parsePaymentMethod("não lembro")).toBeNull();
    expect(parsePaymentMethod("")).toBeNull();
  });
});

describe("сборка полей дела", () => {
  it("берёт всё, что смогла разобрать", () => {
    const update = fieldsFromFacts([
      { field: "company", value: "Loja Exemplo" },
      { field: "amount", value: "R$ 249,90" },
      { field: "payment_method", value: "Pix" },
      { field: "purchase_date", value: "02/03/2026" },
    ]);

    expect(update.companyName).toBe("Loja Exemplo");
    expect(update.amount).toBe("249.90");
    expect(update.paymentMethod).toBe("PIX");
    expect(update.purchaseDate?.toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("неразобранное поле просто не появляется", () => {
    // Факт остаётся в списке — человек его видит, — но в поле дела
    // неразобранное значение не попадает.
    const update = fieldsFromFacts([
      { field: "amount", value: "uns duzentos reais" },
      { field: "purchase_date", value: "semana passada" },
      { field: "company", value: "Loja Exemplo" },
    ]);

    expect(update).not.toHaveProperty("amount");
    expect(update).not.toHaveProperty("purchaseDate");
    expect(update.companyName).toBe("Loja Exemplo");
  });

  it("поля, которых нет в фактах, не выдумываются", () => {
    expect(fieldsFromFacts([])).toEqual({});
  });

  it("незнакомое поле игнорируется", () => {
    expect(fieldsFromFacts([{ field: "protocol", value: "884512360077" }])).toEqual({});
  });
});
