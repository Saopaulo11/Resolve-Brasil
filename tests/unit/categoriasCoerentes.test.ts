import { describe, expect, it } from "vitest";

import { CATEGORIES } from "../../src/cases/categories";
import { caseCategorySchema } from "../../src/ai/schemas";
import { CaseCategory } from "../../src/generated/prisma/enums";

/**
 * Список категорий живёт в трёх местах: схема базы, общий список и схема
 * ответа модели. Разойтись они могут молча — добавленная категория окажется
 * в форме, но модель о ней не узнает, либо база не примет её значение.
 */
describe("категории согласованы", () => {
  it("список и перечисление базы совпадают", () => {
    const naLista = [...CATEGORIES.map((categoria) => categoria.value)].sort();
    const naBase = Object.values(CaseCategory).sort();

    expect(naLista).toEqual(naBase);
  });

  it("модель знает ровно те же категории", () => {
    const naLista = [...CATEGORIES.map((categoria) => categoria.value)].sort();
    const naModelo = [...caseCategorySchema.options].sort();

    expect(naModelo).toEqual(naLista);
  });

  it("адреса категорий не повторяются и годятся для ссылки", () => {
    const slugs = CATEGORIES.map((categoria) => categoria.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("у каждой категории есть все подписи", () => {
    for (const categoria of CATEGORIES) {
      expect(categoria.label.length, categoria.slug).toBeGreaterThan(0);
      expect(categoria.quickLabel.length, categoria.slug).toBeGreaterThan(0);
      expect(categoria.description.length, categoria.slug).toBeGreaterThan(0);
      expect(categoria.icon.length, categoria.slug).toBeGreaterThan(0);
    }
  });
});
