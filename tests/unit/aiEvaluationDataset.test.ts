import { describe, expect, it } from "vitest";

import { loadDataset, parseDataset, SYNTHETIC_MARKER } from "../../src/ai/evaluation/dataset";

/**
 * §82. Набор обязан быть очевидно выдуманным — и не на словах.
 *
 * Выдуманная жалоба на настоящую компанию это не тестовые данные, а
 * клевета, которая однажды попадёт в отчёт как факт.
 */
const VALID = {
  _aviso: "Conjunto sintético.",
  version: 1,
  cases: [
    {
      id: "eval-001",
      synthetic: true,
      description: "Comprei um produto na Loja Exemplo e ele não chegou no prazo combinado.",
      companyName: "Loja Exemplo",
      amount: "100.00",
      paymentMethod: "PIX",
      expectedCategory: "PRODUTO_NAO_RECEBIDO",
      note: "Caso direto.",
    },
  ],
};

describe("набор для оценки (§82)", () => {
  it("принимает корректный набор", () => {
    expect(parseDataset(VALID).cases).toHaveLength(1);
  });

  it("отказывается от настоящей компании в выдуманной жалобе", () => {
    const comEmpresaReal = {
      ...VALID,
      cases: [{ ...VALID.cases[0], companyName: "Alguma Empresa S.A." }],
    };

    expect(() => parseDataset(comEmpresaReal)).toThrow(/companyName/);
  });

  it("отказывается от дела без пометки о выдуманности", () => {
    const semMarca = {
      ...VALID,
      cases: [{ ...VALID.cases[0], synthetic: false }],
    };

    expect(() => parseDataset(semMarca)).toThrow();
  });

  it("отказывается от повторяющихся идентификаторов", () => {
    const repetido = { ...VALID, cases: [VALID.cases[0], VALID.cases[0]] };
    expect(() => parseDataset(repetido)).toThrow(/Повторяющийся/);
  });

  it("отказывается от лишнего поля", () => {
    // Незнакомое поле — обычно забытая правка формата, а не новая мысль.
    const extra = {
      ...VALID,
      cases: [{ ...VALID.cases[0], realCustomerName: "João" }],
    };
    expect(() => parseDataset(extra)).toThrow();
  });
});

describe("набор в репозитории", () => {
  const dataset = loadDataset();

  it("загружается и не пуст", () => {
    expect(dataset.cases.length).toBeGreaterThan(0);
  });

  it("каждое дело помечено как выдуманное", () => {
    for (const item of dataset.cases) {
      expect(item.synthetic, item.id).toBe(true);
      expect(item.companyName, item.id).toContain(SYNTHETIC_MARKER);
    }
  });

  it("покрывает все категории, которые различает продукт", () => {
    // Набор без «OUTRO» не поймал бы самую частую ошибку: уверенную
    // категорию там, где человек ничего толком не рассказал.
    const categorias = new Set(dataset.cases.map((item) => item.expectedCategory));
    expect(categorias.size).toBeGreaterThanOrEqual(6);
    expect(categorias).toContain("OUTRO");
  });

  it("предупреждение о выдуманности стоит в самом файле", () => {
    expect(dataset._aviso).toMatch(/sint[ée]tico/i);
  });
});
