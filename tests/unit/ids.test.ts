import { describe, expect, it } from "vitest";

import { generatePublicCaseId, isValidPublicCaseId } from "../../src/utils/ids";

describe("публичный идентификатор дела", () => {
  it("имеет формат RB-XXXXXX", () => {
    expect(generatePublicCaseId()).toMatch(/^RB-[A-Z2-9]{6}$/);
  });

  it("не содержит символов, которые путают при диктовке", () => {
    // 0/O и 1/I/L перепутать легко, и человек попадёт в чужое дело.
    const ids = Array.from({ length: 300 }, () => generatePublicCaseId());
    for (const id of ids) {
      expect(id.slice(3)).not.toMatch(/[01OIL]/);
    }
  });

  it("не последовательный: подряд сгенерированные не совпадают", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generatePublicCaseId()));
    // Коллизии на 500 значениях из 31^6 практически исключены.
    expect(ids.size).toBe(500);
  });

  it("проверка формата отклоняет чужие идентификаторы", () => {
    expect(isValidPublicCaseId("RB-ABC234")).toBe(true);
    expect(isValidPublicCaseId("RB-000123")).toBe(false);
    expect(isValidPublicCaseId("XX-ABC234")).toBe(false);
    expect(isValidPublicCaseId("RB-ABC23")).toBe(false);
  });
});
