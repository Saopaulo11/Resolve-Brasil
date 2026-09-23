import { NextResponse } from "next/server";

import type { HealthCheck, HealthReport } from "@/lib/health";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Здоровье стенда меряется в момент запроса, кешировать его нельзя.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — что именно сломано на стенде.
 *
 * 200 — приложение видит Supabase и читает из базы.
 * 503 — не видит; в поле detail лежит причина, а не общее «ошибка».
 */
export async function GET() {
  const startedAt = Date.now();
  const env = readSupabaseEnv();

  const config: HealthCheck = env
    ? { ok: true, detail: env.url }
    : {
        ok: false,
        detail:
          "нет NEXT_PUBLIC_SUPABASE_URL и/или NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      };

  let database: HealthCheck = { ok: false, detail: "не проверялась: нет конфигурации" };

  if (env) {
    try {
      const supabase = await createSupabaseServerClient();
      // Чтение под RLS-политикой: проверяет разом и сеть, и ключ, и политику.
      const { error } = await supabase
        .from("app_status")
        .select("label")
        .eq("id", 1)
        .single();

      database = error
        ? { ok: false, detail: error.message }
        : { ok: true, detail: "чтение app_status прошло" };
    } catch (cause) {
      database = {
        ok: false,
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  const ok = config.ok && database.ok;

  const report: HealthReport = {
    status: ok ? "ok" : "error",
    checks: { config, database },
    tookMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(report, { status: ok ? 200 : 503 });
}
