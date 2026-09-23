import { createBrowserClient } from "@supabase/ssr";

import { requireSupabaseEnv } from "./env";

/**
 * Клиент Supabase для браузера. Вызывать только из клиентских компонентов
 * ("use client"): сессию он хранит в куках документа.
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = requireSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}
