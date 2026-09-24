import type { Request, Response } from "express";

import { limparMensagem } from "../boot/failureServer";
import { loadConfig } from "../config/env";
import { db, isDatabaseConfigured } from "../services/db";

/**
 * GET /health — что именно не работает на стенде.
 *
 * 200 — приложение видит базу и умеет из неё читать.
 * 503 — не видит; причина указывается словами, а не общим «ошибка».
 *
 * Маршрут открыт без входа — иначе он бесполезен как проверка. Поэтому
 * причина проходит ту же очистку, что и страница отказа при старте: в
 * сообщении драйвера базы приезжает строка подключения целиком, вместе с
 * паролем (§6, §41).
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
    const dica = dicaDeConexao();
    return {
      ok: false,
      detail: dica ? `${limparMensagem(error)} — ${dica}` : limparMensagem(error),
    };
  }
}

/**
 * Подсказка про строку подключения.
 *
 * Прямой хост Supabase не имеет записи IPv4 — только IPv6, а исходящего
 * IPv6 у бессерверных функций нет. Соединение не начинается вовсе, и в
 * логах базы не появляется ни одной попытки входа: отказ выглядит как
 * неверный пароль и ищется часами. Здесь он называется словами.
 *
 * Хост — не секрет: он и так виден в сообщении драйвера. Пароль и остальная
 * строка сюда не попадают: берётся только hostname.
 */
function dicaDeConexao(): string | null {
  const url = loadConfig().database.url;
  if (!url) return null;

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  if (!/^db\..+\.supabase\.co$/i.test(host)) return null;

  return (
    `${host} é a conexão direta, que só existe em IPv6 — funções serverless ` +
    "não têm saída IPv6. Use a string do Transaction pooler (porta 6543), " +
    "em Supabase → Connect."
  );
}
