import type { Request, Response } from "express";

import { CATEGORIES } from "../cases/categories";
import { loadConfig } from "../config/env";

/**
 * robots.txt и sitemap.xml (§33).
 *
 * Отдаются приложением, а не лежат файлами в public/: оба должны называть
 * полный адрес сайта, а он приходит из APP_URL и на стенде и в production
 * разный. Файл со вписанным адресом однажды уехал бы не туда.
 */

/** Страницы, которые можно показывать в поиске. */
const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/como-funciona",
  "/categorias",
  "/sobre",
  "/privacidade",
  "/termos",
];

/**
 * Закрытое от обхода.
 *
 * Дело, личный кабинет, вход и админка не должны попадать в поиск: там
 * чужие персональные данные и страницы, которые без входа всё равно ничего
 * не покажут. Запрет в robots.txt — не защита (она в проверке доступа), а
 * способ не тратить обход и не плодить бесполезные результаты.
 */
const DISALLOWED: readonly string[] = [
  "/caso/",
  "/documentos/",
  "/minha-conta",
  "/entrar",
  "/admin",
  "/health",
];

function origem(): string {
  return loadConfig().appUrl.replace(/\/+$/, "");
}

export function robots(_req: Request, res: Response): void {
  const linhas = [
    "User-agent: *",
    ...DISALLOWED.map((caminho) => `Disallow: ${caminho}`),
    "",
    `Sitemap: ${origem()}/sitemap.xml`,
    "",
  ];

  res
    .type("text/plain; charset=utf-8")
    .set("cache-control", "public, max-age=3600")
    .send(linhas.join("\n"));
}

/** Экранирование для XML: адрес категории приходит из данных. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sitemap(_req: Request, res: Response): void {
  const base = origem();

  // Страницы категорий ведут на главную с выбранной категорией — это
  // отдельные входы из поиска, и они в карте нужны.
  const caminhos = [
    ...PUBLIC_PATHS,
    ...CATEGORIES.map((categoria) => `/categorias/${categoria.slug}`),
  ];

  const urls = caminhos
    .map((caminho) => `  <url>\n    <loc>${escapar(base + caminho)}</loc>\n  </url>`)
    .join("\n");

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    "</urlset>\n";

  res
    .type("application/xml; charset=utf-8")
    .set("cache-control", "public, max-age=3600")
    .send(xml);
}
