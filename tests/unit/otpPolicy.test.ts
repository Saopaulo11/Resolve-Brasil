import { describe, expect, it } from "vitest";

import {
  attemptsLeft,
  canResend,
  evaluateChallenge,
  expiryFrom,
  secondsUntilResend,
  type OtpChallengeState,
} from "../../src/users/otpPolicy";

const NOW = new Date("2026-09-23T12:00:00.000Z");

function challenge(overrides: Partial<OtpChallengeState> = {}): OtpChallengeState {
  return {
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    invalidatedAt: null,
    expiresAt: new Date(NOW.getTime() + 300_000),
    ...overrides,
  };
}

describe("правила одноразовых кодов", () => {
  it("свежий неиспользованный код годен", () => {
    expect(evaluateChallenge(challenge(), NOW)).toBe("valido");
  });

  it("использованный код не годится повторно", () => {
    // §67: код одноразовый. Иначе перехваченное SMS работает вечно.
    expect(evaluateChallenge(challenge({ consumedAt: NOW }), NOW)).toBe("ja_usado");
  });

  it("заменённый код не годится", () => {
    expect(evaluateChallenge(challenge({ invalidatedAt: NOW }), NOW)).toBe("substituido");
  });

  it("истёкший код не годится", () => {
    const expired = challenge({ expiresAt: new Date(NOW.getTime() - 1) });
    expect(evaluateChallenge(expired, NOW)).toBe("expirado");
  });

  it("код мёртв ровно в момент истечения, а не секундой позже", () => {
    const exact = challenge({ expiresAt: NOW });
    expect(evaluateChallenge(exact, NOW)).toBe("expirado");
  });

  it("исчерпанные попытки закрывают код", () => {
    expect(evaluateChallenge(challenge({ attempts: 5 }), NOW)).toBe(
      "tentativas_esgotadas",
    );
  });

  it("истечение важнее исчерпанных попыток", () => {
    // Иначе человеку скажут «много попыток», он будет ждать снятия лимита,
    // а нужно было просто запросить новый код.
    const both = challenge({
      attempts: 5,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(evaluateChallenge(both, NOW)).toBe("expirado");
  });

  it("использование важнее всего остального", () => {
    const messy = challenge({
      consumedAt: NOW,
      invalidatedAt: NOW,
      attempts: 9,
      expiresAt: new Date(NOW.getTime() - 1),
    });
    expect(evaluateChallenge(messy, NOW)).toBe("ja_usado");
  });

  it("считает оставшиеся попытки и не уходит в минус", () => {
    expect(attemptsLeft(challenge({ attempts: 2 }))).toBe(3);
    expect(attemptsLeft(challenge({ attempts: 9 }))).toBe(0);
  });

  it("считает срок истечения от текущего момента", () => {
    expect(expiryFrom(NOW, 300).toISOString()).toBe("2026-09-23T12:05:00.000Z");
  });
});

describe("пауза между отправками", () => {
  it("первый запрос не ждёт", () => {
    expect(canResend(null, 60, NOW)).toBe(true);
    expect(secondsUntilResend(null, 60, NOW)).toBe(0);
  });

  it("сразу после отправки ждать полную паузу", () => {
    expect(secondsUntilResend(NOW, 60, NOW)).toBe(60);
    expect(canResend(NOW, 60, NOW)).toBe(false);
  });

  it("после паузы можно снова", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(canResend(NOW, 60, later)).toBe(true);
  });

  it("остаток округляется вверх — ноль показывается только когда правда ноль", () => {
    const almost = new Date(NOW.getTime() + 59_500);
    expect(secondsUntilResend(NOW, 60, almost)).toBe(1);
  });
});
