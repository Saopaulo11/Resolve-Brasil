import { describe, expect, it } from "vitest";

import type { AdminRole } from "../../src/generated/prisma/enums";
import {
  GRANTED_TO_NOBODY,
  can,
  permissionsFor,
  ROLE_PERMISSIONS,
} from "../../src/admin/rbac";

const ALL_ROLES: AdminRole[] = ["VIEWER", "SUPPORT", "ANALYST", "ADMIN", "OWNER"];

describe("права администраторов (§51)", () => {
  it("документы не доступны ни одной роли", () => {
    // Главное правило фазы: документы — это паспорта, выписки и переписка
    // живых людей. Один доступ «на всякий случай» становится постоянным.
    for (const role of ALL_ROLES) {
      expect(can(role, "documents.read"), role).toBe(false);
    }
    expect(GRANTED_TO_NOBODY).toContain("documents.read");
  });

  it("минимальная роль видит только сводку", () => {
    expect(permissionsFor("VIEWER")).toEqual(["dashboard.view"]);
  });

  it("поддержка видит дела, но не пользователей и не журнал", () => {
    expect(can("SUPPORT", "cases.detail")).toBe(true);
    expect(can("SUPPORT", "users.list")).toBe(false);
    expect(can("SUPPORT", "audit.view")).toBe(false);
  });

  it("аналитик видит аналитику, но не дела", () => {
    // Аналитику нужны агрегаты, а не конкретные обращения.
    expect(can("ANALYST", "analytics.view")).toBe(true);
    expect(can("ANALYST", "cases.detail")).toBe(false);
  });

  it("управлять администраторами может только владелец", () => {
    expect(can("OWNER", "admins.manage")).toBe(true);
    for (const role of ALL_ROLES.filter((r) => r !== "OWNER")) {
      expect(can(role, "admins.manage"), role).toBe(false);
    }
  });

  it("журнал доступен только администрированию", () => {
    expect(can("ADMIN", "audit.view")).toBe(true);
    expect(can("OWNER", "audit.view")).toBe(true);
    expect(can("SUPPORT", "audit.view")).toBe(false);
    expect(can("ANALYST", "audit.view")).toBe(false);
  });

  it("у каждой роли права описаны явно", () => {
    // Роль без записи в матрице молча получила бы пустой набор — и это
    // обнаружилось бы отказом в доступе, а не ошибкой.
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role], role).toBeDefined();
    }
  });

  it("права расширяются, а не сужаются с ростом роли", () => {
    // VIEWER ⊆ ADMIN ⊆ OWNER: неожиданная дыра в середине лестницы —
    // частая и тихая ошибка в матрицах прав.
    for (const permission of permissionsFor("VIEWER")) {
      expect(can("ADMIN", permission), permission).toBe(true);
    }
    for (const permission of permissionsFor("ADMIN")) {
      expect(can("OWNER", permission), permission).toBe(true);
    }
  });
});
