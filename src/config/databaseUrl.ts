/**
 * Строка подключения к базе, собранная из частей.
 *
 * Зачем вообще: строка состоит из пяти кусков, и ошибиться можно в любом.
 * Самая дорогая ошибка — подставить прямое подключение вместо пула: у
 * прямого хоста Supabase нет записи IPv4, исходящего IPv6 у бессерверных
 * функций тоже нет, соединение не начинается, и отказ выглядит как неверный
 * пароль — в логах базы при этом пусто. Такое ищут часами.
 *
 * Поэтому несекретные части (хост, порт, пользователь, имя базы) задаются
 * отдельными переменными и меняются редко, а секретом остаётся один пароль.
 * При ротации меняется одно поле, и испортить хост при этом нечем.
 *
 * DATABASE_URL остаётся главным: он стандартен, его понимают Prisma CLI и
 * любая машина разработчика. Сборка включается только когда его нет.
 */

const PORTA_PADRAO = 5432;
const BASE_PADRAO = "postgres";

export type DatabaseParts = {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  name?: string;
  params?: string;
};

/**
 * Чего не хватает для сборки. Пустой список — можно собирать.
 *
 * Хост, пользователь и пароль обязательны: без любого из них строка
 * получится синтаксически верной, но подключится не туда, куда нужно, —
 * а это худший исход, чем честный отказ.
 */
export function partesFaltando(parts: DatabaseParts): string[] {
  const faltando: string[] = [];
  if (!parts.host?.trim()) faltando.push("DATABASE_HOST");
  if (!parts.user?.trim()) faltando.push("DATABASE_USER");
  if (!parts.password) faltando.push("DATABASE_PASSWORD");
  return faltando;
}

/**
 * Собирает строку. Возвращает null, если частей не хватает.
 *
 * Пароль кодируется: `@`, `:`, `/` и `#` внутри него разбирают строку не
 * так, как человек ожидает, — `@` вообще делает хостом кусок пароля. Это
 * вторая по частоте ошибка после неправильного хоста, и здесь её больше
 * нельзя совершить.
 */
export function composeDatabaseUrl(parts: DatabaseParts): string | null {
  if (partesFaltando(parts).length > 0) return null;

  const host = (parts.host as string).trim();
  const user = encodeURIComponent((parts.user as string).trim());
  const password = encodeURIComponent(parts.password as string);
  const port = Number.parseInt(parts.port?.trim() ?? "", 10) || PORTA_PADRAO;
  const base = parts.name?.trim() || BASE_PADRAO;

  // Параметры принимаем и с ведущим «?», и без него: из консоли Supabase
  // их копируют по-разному, а разница ничего не значит.
  const params = parts.params?.trim().replace(/^\?/, "") ?? "";
  const cauda = params.length > 0 ? `?${params}` : "";

  return `postgresql://${user}:${password}@${host}:${port}/${encodeURIComponent(base)}${cauda}`;
}

/** Части из окружения — в том виде, в каком их ждёт composeDatabaseUrl. */
export function partsFromEnv(env: NodeJS.ProcessEnv): DatabaseParts {
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    name: env.DATABASE_NAME,
    params: env.DATABASE_PARAMS,
  };
}

/**
 * Итоговая строка: либо заданная целиком, либо собранная из частей.
 *
 * Порядок именно такой. DATABASE_URL задают осознанно и целиком — если он
 * есть, спорить с ним нечем. Части нужны там, где строку собирают по кускам
 * в панели платформы, а ошибиться в ней стоит дорого.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const direta = env.DATABASE_URL?.trim();
  if (direta) return direta;
  return composeDatabaseUrl(partsFromEnv(env));
}
