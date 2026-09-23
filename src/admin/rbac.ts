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
  | "feedback.view"
  | "notifications.view"
  | "settings.view"
  | "ai.view"
  | "companies.view"
  /**
   * Перечень документов: тип, размер, состояние, дата. Без имени файла и
   * без содержимого. Имя файла — уже персональные данные: «cpf-joao.pdf»
   * говорит достаточно.
   */
  | "documents.list"
  /** Содержимое документов. Не выдаётся никому — см. GRANTED_TO_NOBODY. */
  | "documents.read";

const VIEWER_PERMISSIONS: readonly Permission[] = ["dashboard.view"];

const ANALYST_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  "analytics.view",
  "ai.view",
  "feedback.view",
  "companies.view",
];

const SUPPORT_PERMISSIONS: readonly Permission[] = [
  ...VIEWER_PERMISSIONS,
  "cases.list",
  "cases.detail",
  "documents.list",
  "feedback.view",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  // Набор строится из предыдущих намеренно: так дыра в середине лестницы
  // ролей становится невозможной, а не просто маловероятной.
  ...new Set<Permission>([
    ...ANALYST_PERMISSIONS,
    ...SUPPORT_PERMISSIONS,
    "users.list",
    "sources.manage",
    "audit.view",
    "notifications.view",
    "settings.view",
  ]),
];

const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  VIEWER: VIEWER_PERMISSIONS,
  ANALYST: ANALYST_PERMISSIONS,
  SUPPORT: SUPPORT_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  // Владелец управляет администраторами — но и он не получает доступа к
  // содержимому документов пользователей (см. ниже).
  OWNER: [...ADMIN_PERMISSIONS, "admins.manage"],
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
