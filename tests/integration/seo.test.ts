import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, type Harness } from "../helpers/auth";

/**
 * Что видит поисковик и что видит мессенджер (§33).
 *
 * Сайт живёт органическим поиском, а ссылками здесь делятся в WhatsApp.
 * Обе стороны читают не страницу, а несколько тегов и два файла.
 */

let harness: Harness;

beforeEach(() => {
  process.env.APP_URL = "https://exemplo.test";
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  delete process.env.APP_URL;
  resetConfigCache();
});

describe("robots.txt", () => {
  it("указывает карту сайта полным адресом", async () => {
    const resposta = await request(harness.app).get("/robots.txt");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/text\/plain/);
    expect(resposta.text).toContain("Sitemap: https://exemplo.test/sitemap.xml");
  });

  it("закрывает от обхода дела и личный кабинет", async () => {
    // Там чужие персональные данные, и без входа страница всё равно пуста.
    const resposta = await request(harness.app).get("/robots.txt");

    for (const caminho of ["/caso/", "/documentos/", "/minha-conta", "/admin"]) {
      expect(resposta.text, caminho).toContain(`Disallow: ${caminho}`);
    }
  });
});

describe("sitemap.xml", () => {
  it("перечисляет публичные страницы полными адресами", async () => {
    const resposta = await request(harness.app).get("/sitemap.xml");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/xml/);
    expect(resposta.text).toContain("<loc>https://exemplo.test/</loc>");
    expect(resposta.text).toContain("<loc>https://exemplo.test/como-funciona</loc>");
    expect(resposta.text).toContain("<loc>https://exemplo.test/termos</loc>");
  });

  it("не выдаёт закрытые страницы", async () => {
    const resposta = await request(harness.app).get("/sitemap.xml");

    for (const caminho of ["/minha-conta", "/entrar", "/admin", "/health"]) {
      expect(resposta.text, caminho).not.toContain(`${caminho}</loc>`);
    }
  });

  it("включает страницы категорий — это входы из поиска", async () => {
    const resposta = await request(harness.app).get("/sitemap.xml");
    expect(resposta.text).toContain("/categorias/produto-nao-recebido</loc>");
  });
});

describe("теги страницы", () => {
  it("канонический адрес не зависит от строки запроса", async () => {
    // «/?categoria=x» и «/» — одна страница; иначе вес делится между ними.
    const resposta = await request(harness.app).get("/?categoria=cobranca-indevida");

    expect(resposta.text).toContain(
      '<link rel="canonical" href="https://exemplo.test/" />',
    );
  });

  it("карточка ссылки называет картинку полным адресом", async () => {
    const resposta = await request(harness.app).get("/");

    expect(resposta.text).toContain(
      'content="https://exemplo.test/images/brand/og-card.png"',
    );
    expect(resposta.text).toContain('property="og:image:width" content="1200"');
    expect(resposta.text).toContain('name="twitter:card" content="summary_large_image"');
    expect(resposta.text).toContain('property="og:url"');
  });

  it("иконка для iOS растровая", async () => {
    // SVG в apple-touch-icon iOS не берёт — была бы иконка по умолчанию.
    const resposta = await request(harness.app).get("/");

    expect(resposta.text).toMatch(
      /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/,
    );
  });

  it("канонический адрес есть и на странице, требующей входа", async () => {
    const cookies = await login(harness, "11987654321");
    const resposta = await request(harness.app)
      .get("/minha-conta")
      .set("Cookie", cookies);

    expect(resposta.status).toBe(200);
    expect(resposta.text).toContain(
      '<link rel="canonical" href="https://exemplo.test/minha-conta" />',
    );
  });
});

describe("файлы, на которые ссылаются", () => {
  /*
   * Манифест с иконкой, которой нет, выглядит исправным в любом тесте на
   * разметку: ссылка есть. Android при этом ставит иконку по умолчанию, и
   * замечает это только тот, кто поставил приложение себе.
   */
  it("каждая иконка манифеста лежит на месте", async () => {
    const manifesto = await request(harness.app).get("/manifest.webmanifest");
    expect(manifesto.status).toBe(200);

    const icones = (manifesto.body as { icons: Array<{ src: string }> }).icons;
    expect(icones.length).toBeGreaterThan(0);

    for (const icone of icones) {
      const arquivo = await request(harness.app).get(icone.src);
      expect(arquivo.status, icone.src).toBe(200);
    }
  });

  it("у манифеста есть растровые иконки для установки на Android", async () => {
    // Одного SVG для установки недостаточно: нужны 192 и 512, и maskable.
    const manifesto = await request(harness.app).get("/manifest.webmanifest");
    const icones = (manifesto.body as {
      icons: Array<{ sizes: string; type: string; purpose?: string }>;
    }).icons;

    const png = icones.filter((icone) => icone.type === "image/png");
    expect(png.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(png.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("картинка карточки и иконка iOS отдаются", async () => {
    for (const caminho of [
      "/images/brand/og-card.png",
      "/icons/apple-touch-icon.png",
    ]) {
      const arquivo = await request(harness.app).get(caminho);
      expect(arquivo.status, caminho).toBe(200);
      expect(arquivo.headers["content-type"], caminho).toMatch(/image\/png/);
    }
  });
});
