import type { Request, Response } from "express";

import { loadConfig } from "../config/env";
import { db, isDatabaseConfigured } from "../services/db";

/**
 * GET /health — что именно не работает на стенде.
 *
 * 200 — приложение видит базу и умеет из неё читать.
 * 503 — не видит; причина указывается словами, а не общим «ошибка».
 */
type Check = { ok: boolean; detail: string };

export async function health(_req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();

  const database: Check = isDatabaseConfigured()
    ? await checkDatabase()
    : { ok: false, detail: "DATABASE_URL não configurado" };

  // Провайдер mock — рабочее состояние для разработки, но не «всё хорошо»:
  // на нём никакого анализа не происходит (§79).
  const ai: Check = {
    ok: config.ai.provider !== "mock",
    detail:
      config.ai.provider === "mock"
        ? "AI_PROVIDER=mock — nenhuma análise real é executada"
        : `AI_PROVIDER=${config.ai.provider}`,
  };

  const ok = database.ok;

  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "error",
    checks: { database, ai },
    tookMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  });
}

async function checkDatabase(): Promise<Check> {
  try {
    await db().$queryRaw`select 1`;
    return { ok: true, detail: "consulta executada" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
