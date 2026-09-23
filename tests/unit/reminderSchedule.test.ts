import { describe, expect, it } from "vitest";

import { resolveScheduledAt } from "../../src/notifications/reminderService";

const NOW = new Date("2026-09-23T12:00:00.000Z");

describe("срок напоминания", () => {
  it("считает готовые сроки от текущего момента", () => {
    const result = resolveScheduledAt("3d", null, NOW);
    expect(result).toBeInstanceOf(Date);
    if (result instanceof Date) {
      const days = (result.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(3);
    }
  });

  it("отвергает неизвестный срок", () => {
    expect(resolveScheduledAt("99d", null, NOW)).toBe("prazo_invalido");
  });

  it("ставит выбранной дате утреннее время по местному часовому поясу", () => {
    // <input type="date"> даёт YYYY-MM-DD. Без времени дата разобралась бы
    // как полночь UTC — а в Бразилии это предыдущий день.
    const result = resolveScheduledAt(null, "2026-12-01", NOW);
    expect(result).toBeInstanceOf(Date);
    if (result instanceof Date) {
      expect(result.getDate()).toBe(1);
      expect(result.getMonth()).toBe(11);
      expect(result.getHours()).toBe(9);
    }
  });

  it("отвергает дату в прошлом", () => {
    expect(resolveScheduledAt(null, "2020-01-01", NOW)).toBe("prazo_passado");
  });

  it("отвергает дату дальше года", () => {
    // Дело столько не живёт, и напоминание через два года — потерянное.
    expect(resolveScheduledAt(null, "2030-01-01", NOW)).toBe("prazo_distante");
  });

  it("отвергает мусор вместо даты", () => {
    expect(resolveScheduledAt(null, "amanhã", NOW)).toBe("prazo_invalido");
    expect(resolveScheduledAt(null, "", NOW)).toBe("prazo_invalido");
    expect(resolveScheduledAt(null, null, NOW)).toBe("prazo_invalido");
  });
});
