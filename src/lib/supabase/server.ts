import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseEnv } from "./env";

/**
 * Клиент Supabase для серверного кода: Server Components, Route Handlers,
 * Server Actions.
 *
 * Клиент создаётся на каждый запрос и не кешируется между ними — внутри лежит
 * сессия пользователя из куки. Один общий клиент на процесс показал бы данные
 * одного посетителя другому.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component: куки там доступны только на чтение, запись
          // бросает. Это не потеря — обновлённую сессию всё равно записывает
          // proxy.ts, который выполняется раньше рендера.
        }
      },
    },
  });
}
