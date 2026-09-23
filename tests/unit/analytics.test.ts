import { describe, expect, it } from "vitest";

import { amountBucket, pseudonymize } from "../../src/analytics/events";

describe("приватность аналитики", () => {
  it("заменяет точную сумму диапазоном", () => {
    // Точная сумма вместе с месяцем и городом опознаёт человека (§56).
    expect(amountBucket(349.9)).toBe("200-500");
    expect(amountBucket(49)).toBe("0-50");
    expect(amountBucket(12000)).toBe("5000+");
    expect(amountBucket(null)).toBeNull();
  });

  it("псевдоним не совпадает с исходным идентификатором", () => {
    const userId = "6f1a2b3c-0000-4000-8000-000000000000";
    const key = pseudonymize(userId, "segredo");
    expect(key).not.toContain(userId);
    expect(key).toHaveLength(32);
  });

  it("с другим секретом даёт другой псевдоним", () => {
    // Без секрета хеш от user_id перебирается за секунды.
    const userId = "6f1a2b3c-0000-4000-8000-000000000000";
    expect(pseudonymize(userId, "a")).not.toBe(pseudonymize(userId, "b"));
  });

  it("с тем же секретом стабилен", () => {
    const userId = "6f1a2b3c-0000-4000-8000-000000000000";
    expect(pseudonymize(userId, "s")).toBe(pseudonymize(userId, "s"));
  });
});
