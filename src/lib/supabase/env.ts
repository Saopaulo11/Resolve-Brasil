import { z } from "zod";

/**
 * Конфигурация Supabase. Читается лениво, а не на уровне модуля: `next build`
 * не должен требовать ключи. На Vercel они есть и на сборке, и в рантайме, а
 * в CI (GitHub Actions) — нет, и сборка там всё равно обязана проходить.
 */
export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

const schema = z.object({
  url: z.url({ error: "NEXT_PUBLIC_SUPABASE_URL: ожидается URL вида https://<ref>.supabase.co" }),
  publishableKey: z.string().min(1),
});

/**
 * Обращения к `process.env.NEXT_PUBLIC_*` должны быть буквальными: Next
 * подставляет значения в бандл на этапе сборки по точному совпадению текста.
 * Динамический доступ (`process.env[name]`) в браузере вернёт undefined.
 */
function rawEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Второе имя — для совместимости с интеграцией Vercel ↔ Supabase,
    // которая прокидывает ключ как ANON_KEY.
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Конфигурация или null, если переменные не заданы. Не бросает. */
export function readSupabaseEnv(): SupabaseEnv | null {
  const parsed = schema.safeParse(rawEnv());
  return parsed.success ? parsed.data : null;
}

/** Конфигурация или понятная ошибка. Для кода, который без базы бессмыслен. */
export function requireSupabaseEnv(): SupabaseEnv {
  const parsed = schema.safeParse(rawEnv());
  if (!parsed.success) {
    throw new Error(
      "Supabase не настроен. Задайте NEXT_PUBLIC_SUPABASE_URL и " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (см. .env.example). " +
        z.prettifyError(parsed.error),
    );
  }
  return parsed.data;
}
