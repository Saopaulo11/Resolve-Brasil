import { describe, expect, it } from "vitest";

import { detectIndustry, INDUSTRY_LABELS } from "../../src/companies/industry";
import {
  isUsableCompanyName,
  normalizeCompanyName,
} from "../../src/companies/normalize";

/**
 * §85, §86.
 *
 * Проверяется и то, что нормализация склеивает написания одной компании, и
 * то, что она не склеивает разные: ошибка во вторую сторону дороже — два
 * разных бизнеса в одной строке отчёта уже не разделить.
 */
describe("нормализация названия (§85)", () => {
  it("склеивает написания одной компании", () => {
    const formas = [
      "Loja Exemplo",
      "LOJA EXEMPLO",
      "loja exemplo",
      "Loja Exemplo S.A.",
      "Loja Exemplo LTDA",
      "  Loja   Exemplo  ",
      "Loja Exemplo Ltda.",
    ];

    const normalizados = new Set(formas.map(normalizeCompanyName));
    expect(normalizados).toEqual(new Set(["loja exemplo"]));
  });

  it("убирает диакритику", () => {
    expect(normalizeCompanyName("Serviços Exemplo")).toBe(normalizeCompanyName("Servicos Exemplo"));
  });

  it("не склеивает разные компании", () => {
    expect(normalizeCompanyName("Loja Exemplo")).not.toBe(
      normalizeCompanyName("Loja Exemplo Digital"),
    );
  });

  it("снимает форму только с конца названия", () => {
    // «Comercio Exemplo» — это название, а не «Exemplo» с хвостом.
    expect(normalizeCompanyName("Comercio Exemplo")).toBe("comercio exemplo");
    expect(normalizeCompanyName("Exemplo Comercio")).toBe("exemplo");
  });

  it("не съедает название целиком", () => {
    // Из «Brasil Ltda» не должно остаться пустоты: пустая строка склеила бы
    // все такие дела в одну несуществующую компанию.
    expect(normalizeCompanyName("Brasil Ltda")).not.toBe("");
  });

  it("отбрасывает негодные названия", () => {
    expect(isUsableCompanyName("")).toBe(false);
    expect(isUsableCompanyName("X")).toBe(false);
    expect(isUsableCompanyName("   ")).toBe(false);
    expect(isUsableCompanyName("Loja Exemplo")).toBe(true);
  });
});

describe("отрасль по названию (§86)", () => {
  it("узнаёт то, что компания сказала о себе сама", () => {
    expect(detectIndustry("Banco Exemplo").industry).toBe("BANKING");
    expect(detectIndustry("Exemplo Seguros").industry).toBe("INSURANCE");
    expect(detectIndustry("Exemplo Telecom").industry).toBe("TELECOM");
    expect(detectIndustry("Viagens Exemplo").industry).toBe("TRAVEL");
    expect(detectIndustry("Exemplo Energia").industry).toBe("UTILITIES");
  });

  it("более точное правило выигрывает у более общего", () => {
    // «loja online» — это торговля через интернет, а не просто магазин.
    expect(detectIndustry("Loja Online Exemplo").industry).toBe("ECOMMERCE");
    expect(detectIndustry("Loja Exemplo").industry).toBe("RETAIL");
  });

  it("маркер обязан быть отдельным словом", () => {
    // Иначе «Bancoexemplo» и «Segurofacil» попадут в отрасль по совпадению
    // букв внутри слова.
    expect(detectIndustry("Bancoexemplo").industry).toBe("OTHER");
    expect(detectIndustry("Seguroteste").industry).toBe("OTHER");
  });

  it("не угадывает, когда не знает", () => {
    const guess = detectIndustry("Exemplo Tecnologia");
    expect(guess.industry).toBe("OTHER");
    expect(guess.evidence).toBeNull();
  });

  it("называет слово, по которому определила", () => {
    // Без этого ошибку правила невозможно заметить: отрасль выглядит
    // одинаково достоверно и когда угадана, и когда взята из названия.
    expect(detectIndustry("Banco Exemplo").evidence).toBe("banco");
  });

  it("OTHER подписан как «не определено», а не «прочее»", () => {
    expect(INDUSTRY_LABELS.OTHER).toBe("Não identificado");
  });
});
