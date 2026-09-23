import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/supabase/env";

/**
 * Начиная с Next.js 16 middleware называется proxy, а файл лежит рядом с
 * app/ — то есть в src/proxy.ts. Документация Supabase всё ещё показывает
 * middleware.ts: в этой версии такой файл просто не будет вызван.
 *
 * Задача здесь одна: обновить истекающий access-токен Supabase и переложить
 * свежие куки и в запрос (чтобы рендер увидел новую сессию), и в ответ (чтобы
 * браузер её сохранил). Проверку прав тут не делаем — proxy выполняется до
 * рендера и видит только куки, а решает о доступе серверный код страницы.
 */
export async function proxy(request: NextRequest) {
  const env = readSupabaseEnv();

  // Ключей нет — пропускаем запрос как есть. Иначе незаполненный .env
  // превратил бы каждую страницу, включая главную, в ошибку 500.
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Именно getUser(), а не getSession(): только getUser ходит в Auth-сервер и
  // проверяет токен. getSession() верит куке на слово, а куку правит кто угодно.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Всё, кроме статики Next и картинок: гонять обновление сессии на каждой
    // иконке — лишняя латентность и лишние запросы к Auth.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
