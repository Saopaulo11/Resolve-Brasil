import { loadConfig } from "../config/env";
import { stores } from "../users/storeRegistry";
import { generateSessionToken, hashSessionToken } from "../utils/crypto";

/**
 * Серверные сессии (§15, §66).
 *
 * В куке — случайный токен, в базе — только его SHA-256. Кража дампа базы
 * не даёт войти ни в одну сессию. Сессия отзывается пометкой времени, а не
 * удалением строки: так остаётся след для расследования.
 */
export type SessionInfo = {
  id: string;
  userId: string;
};

export type ClientContext = {
  userAgent: string | null;
  ipPrefix: string | null;
};

export async function createSession(
  userId: string,
  client: ClientContext,
): Promise<string> {
  const config = loadConfig();
  const token = generateSessionToken();

  await stores().sessions.create({
    userId,
    tokenHash: hashSessionToken(token),
    userAgent: client.userAgent,
    ipPrefix: client.ipPrefix,
    expiresAt: new Date(Date.now() + config.session.maxAgeMs),
  });

  return token;
}

export async function resolveSession(token: string): Promise<SessionInfo | null> {
  const session = await stores().sessions.findByTokenHash(hashSessionToken(token));

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  return { id: session.id, userId: session.userId };
}

/**
 * Отметка активности. Пишется не на каждый запрос: апдейт на каждой странице
 * превращает чтение в запись и упирается в базу на ровном месте.
 */
const TOUCH_INTERVAL_MS = 15 * 60_000;

export async function touchSession(sessionId: string): Promise<void> {
  const now = new Date();
  await stores().sessions.touch(
    sessionId,
    new Date(now.getTime() - TOUCH_INTERVAL_MS),
    now,
  );
}

export async function revokeSession(token: string): Promise<void> {
  await stores().sessions.revokeByTokenHash(hashSessionToken(token), new Date());
}

/** Выход со всех устройств — нужен в «Minha conta» и при смене номера. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await stores().sessions.revokeAllForUser(userId, new Date());
}
