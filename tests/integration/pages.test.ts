import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { CATEGORIES } from "../../src/cases/categories";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

describe("публичные страницы", () => {
  it.each([
    ["/", "Conte o que aconteceu"],
    ["/como-funciona", "Como funciona"],
    ["/categorias", "Categorias"],
    ["/sobre", "Sobre o Resolve Brasil"],
    ["/privacidade", "Privacidade"],
    ["/termos", "Termos de uso"],
  ])("%s отдаёт 200 и ожидаемый заголовок", async (path, heading) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.text).toContain(heading);
  });

  it.each([
    ["/privacy", "/privacidade"],
    ["/terms", "/termos"],
  ])("%s ведёт на %s", async (alias, canonico) => {
    // §64 называет эти адреса по-английски, §74 — по-португальски.
    // Каноничны португальские: две страницы с одним текстом разъедутся
    // при первой же правке.
    const response = await request(app).get(alias);
    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(canonico);
  });

  it("главная на бразильском португальском", async () => {
    const response = await request(app).get("/");
    expect(response.text).toContain('<html lang="pt-BR"');
  });

  it("показывает все категории MVP и позволяет выбрать любую", async () => {
    // Проверяется содержимое, а не вёрстка: категории переезжали со
    // страницы на страницу и из ссылок в переключатели формы, и тест,
    // привязанный к имени класса, ломался на каждом переезде, ничего
    // не говоря о том, видит ли человек свою ситуацию в списке.
    const response = await request(app).get("/");

    for (const category of CATEGORIES) {
      expect(response.text, category.slug).toContain(category.quickLabel);
      expect(response.text, category.slug).toContain(`value="${category.slug}"`);
    }
  });

  it("на каждой странице сказано, чем сервис не является", async () => {
    // §3: это не украшение подвала, а обязательное уточнение статуса.
    const response = await request(app).get("/");
    expect(response.text).toContain("não é um escritório de advocacia");
    expect(response.text).toContain("não representa");
  });

  it("не показывает выдуманных отзывов и цифр успеха", async () => {
    // §14, §82: ни одного отзыва и ни одной метрики успеха у нас нет.
    const response = await request(app).get("/");
    expect(response.text).not.toMatch(/depoimento|clientes satisfeitos|casos resolvidos/i);
  });

  it("неизвестный адрес даёт 404, а не ошибку сервера", async () => {
    const response = await request(app).get("/pagina-que-nao-existe");
    expect(response.status).toBe(404);
    expect(response.text).toContain("Página não encontrada");
  });

  it("категория ведёт на главную, а не в никуда", async () => {
    const response = await request(app).get("/categorias/produto-nao-recebido");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/?categoria=produto-nao-recebido");
  });

  it("несуществующая категория даёт 404", async () => {
    const response = await request(app).get("/categorias/inventada");
    expect(response.status).toBe(404);
  });
});

describe("здоровье стенда", () => {
  // Смысл проверки — поведение без базы. С заданным DATABASE_URL проверять
  // нечего, и «упало» здесь означало бы только то, что база настроена.
  it.skipIf(process.env.DATABASE_URL)("без базы честно отвечает 503 с причиной", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(503);
    expect(response.body.checks.database.ok).toBe(false);
    expect(response.body.checks.database.detail).toContain("DATABASE_URL");
  });

  it.skipIf(!process.env.DATABASE_URL)("с базой отвечает 200", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.checks.database.ok).toBe(true);
    // §79: заглушка модели — рабочее состояние стенда, но не «всё хорошо».
    expect(response.body.checks).toHaveProperty("ai");
  });
});
