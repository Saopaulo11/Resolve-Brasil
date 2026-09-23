import { loadConfig } from "../config/env";
import { generateSessionToken, hashSessionToken } from "../utils/crypto";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import { verifyPassword } from "./password";
import type { AdminUserRecord } from "./adminStore";

/**
 * Вход в админку (§51).
 *
 * Отдельно от пользовательского входа во всём: своя кука, своя таблица
 * сессий, свой срок жизни. Общая инфраструктура рано или поздно приводит к
 * пользовательской сессии с правами администратора.
 */
export type LoginResult =
  | { ok: true; admin: AdminUserRecord; token: string }
  | { ok: false; reason: "credenciais" | "bloqueado" | "inativo" };

export type ClientInfo = {
  ipPrefix: string | null;
  userAgent: string | null;
};

export async function login(
  email: string,
  password: string,
  client: ClientInfo,
): Promise<LoginResult> {
  const config = loadConfig();
  const { admins, adminSessions, loginAttempts } = stores();

  const normalizedEmail = email.trim().toLowerCase();
  const since = new Date(Date.now() - config.admin.loginWindowMinutes * 60_000);

  // Порог считается по адресу почты, а не по IP: перебор ведут с разных
  // адресов, а цель у него одна.
  const failures = await loginAttempts.countFailuresSince(normalizedEmail, since);
  if (failures >= config.admin.maxLoginFailures) {
    logger().warn({ email: normalizedEmail, failures }, "login de admin bloqueado");
    return { ok: false, reason: "bloqueado" };
  }

  const admin = await admins.findByEmail(normalizedEmail);

  // Пароль проверяется даже когда администратора нет: иначе по времени
  // ответа видно, существует ли такая учётная запись.
  const stored = admin?.passwordHash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, stored);

  if (!admin || !passwordOk) {
    await loginAttempts.record({
      email: normalizedEmail,
      ipPrefix: client.ipPrefix,
      success: false,
    });
    return { ok: false, reason: "credenciais" };
  }

  if (!admin.active) {
    await loginAttempts.record({
      email: normalizedEmail,
      ipPrefix: client.ipPrefix,
      success: false,
    });
    return { ok: false, reason: "inativo" };
  }

  const token = generateSessionToken();
  const now = new Date();

  await adminSessions.create({
    adminUserId: admin.id,
    tokenHash: hashSessionToken(token),
    ipPrefix: client.ipPrefix,
    userAgent: client.userAgent,
    expiresAt: new Date(now.getTime() + config.admin.sessionMaxAgeHours * 60 * 60_000),
  });

  await admins.markLogin(admin.id, now);
  await loginAttempts.record({
    email: normalizedEmail,
    ipPrefix: client.ipPrefix,
    success: true,
  });

  logger().info({ adminUserId: admin.id, role: admin.role }, "admin autenticado");
  return { ok: true, admin, token };
}

/**
 * Хеш несуществующего пароля.
 *
 * Нужен, чтобы проверка занимала одинаковое время и при отсутствующем
 * администраторе: разница во времени ответа сама по себе отвечает на
 * вопрос, заведена ли такая учётная запись.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAA";

export async function resolveAdminSession(
  token: string,
): Promise<AdminUserRecord | null> {
  const { adminSessions, admins } = stores();

  const session = await adminSessions.findByTokenHash(hashSessionToken(token));
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  const admin = await admins.findById(session.adminUserId);
  // Отключённый администратор теряет доступ немедленно, не дожидаясь
  // истечения сессии.
  if (!admin || !admin.active) return null;

  return admin;
}

export async function logout(token: string): Promise<void> {
  await stores().adminSessions.revokeByTokenHash(hashSessionToken(token), new Date());
}

export { DUMMY_HASH };
