import type { Request } from "express";

import { loadConfig } from "../config/env";
import { db, isDatabaseConfigured } from "./db";
import {
  generateSessionToken,
  hashSessionToken,
  ipPrefix,
} from "../utils/crypto";

/**
 * Серверные сессии (§15, §66).
 *
 * В куке — случайный токен, в базе — только его SHA-256. Кража дампа базы
 * не даёт войти ни в одну сессию. Сессия отзывается пометкой revokedAt, а не
 * удалением строки: так остаётся след для расследования.
 */
export type SessionInfo = {
  id: string;
  userId: string;
};

export async function createSession(userId: string, req: Request): Promise<string> {
  const config = loadConfig();
  const token = generateSessionToken();

  await db().session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
      ipPrefix: ipPrefix(req.ip) ?? null,
      expiresAt: new Date(Date.now() + config.session.maxAgeMs),
    },
  });

  return token;
}

export async function resolveSession(token: string): Promise<SessionInfo | null> {
  if (!isDatabaseConfigured()) return null;

  const session = await db().session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });

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
  const threshold = new Date(Date.now() - TOUCH_INTERVAL_MS);
  await db().session.updateMany({
    where: { id: sessionId, lastSeenAt: { lt: threshold } },
    data: { lastSeenAt: new Date() },
  });
}

export async function revokeSession(token: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await db().session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Выход со всех устройств — нужен в «Minha conta» и при смене номера. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db().session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
