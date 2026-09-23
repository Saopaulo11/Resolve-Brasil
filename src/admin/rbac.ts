import type { AdminRole } from "../generated/prisma/enums";

/**
 * Права администраторов (§51).
 *
 * Матрица, а не проверки «если роль ADMIN» по коду: разбросанные условия
 * невозможно проверить целиком, и однажды одно из них окажется забытым.
 * Здесь видно всё разом, и тест сверяет это с ожиданием.
 */
export type Permission =
  | "dashboard.view"
  | "analytics.view"
  | "cases.list"
  | "cases.detail"
  | "users.list"
  | "sources.manage"
  | "audit.view"
  | "admins.manage"
  | "documents.read";

const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  VIEWER: ["dashboard.view"],

  ANALYST: ["dashboard.view", "analytics.view"],

  SUPPORT: ["dashboard.view", "cases.list", "cases.detail"],

  ADMIN: [
    "dashboard.view",
    "analytics.view",
    "cases.list",
    "cases.detail",
    "users.list",
    "sources.manage",
    "audit.view",
  ],

  // Владелец управляет администраторами — но и он не получает доступа к
  // документам пользователей (см. ниже).
  OWNER: [
    "dashboard.view",
    "analytics.view",
    "cases.list",
    "cases.detail",
    "users.list",
    "sources.manage",
    "audit.view",
    "admins.manage",
  ],
};

/**
 * Права, которых нет ни у одной роли.
 *
 * documents.read не выдаётся никому намеренно (§51). Документы — это
 * паспорта, выписки и переписка живых людей; сотруднику поддержки они для
 * работы не нужны, а один доступ «на всякий случай» превращается в
 * постоянный. Когда такая нужда появится, это будет отдельная роль с
 * отдельным обоснованием, а не тихо добавленная строка в существующую.
 */
export const GRANTED_TO_NOBODY: readonly Permission[] = ["documents.read"];

export function permissionsFor(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: AdminRole, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/** Подписи ролей для интерфейса. */
export const ROLE_LABELS: Record<AdminRole, string> = {
  VIEWER: "Visualização",
  SUPPORT: "Suporte",
  ANALYST: "Análise",
  ADMIN: "Administração",
  OWNER: "Proprietário",
};

export { ROLE_PERMISSIONS };
