import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../helpers/auth";

/**
 * Service worker (§26).
 *
 * Он живёт на чужом устройстве и переживает выкат: ошибка здесь чинится не
 * правкой, а ожиданием, пока у человека обновится копия. Поэтому проверяется
 * не только то, что он отдаётся, но и то, чего он не делает.
 */

let harness: Harness;

const FONTE = readFileSync(
  path.resolve(__dirname, "../../public/sw.js"),
  "utf8",
);

beforeEach(() => {
  harness = createHarness();
});

describe("service worker", () => {
  it("отдаётся своим маршрутом и без долгого кэша", async () => {
    // Недельный срок жизни статики здесь означал бы неделю по старым
    // правилам на чужом устройстве.
    const resposta = await request(harness.app).get("/sw.js");

    expect(resposta.status).toBe(200);
    expect(resposta.headers["content-type"]).toMatch(/javascript/);
    expect(resposta.headers["cache-control"]).toContain("no-cache");
    expect(resposta.headers["service-worker-allowed"]).toBe("/");
  });

  it("страница «нет сети» отдаётся и не содержит ничего личного", async () => {
    const resposta = await request(harness.app).get("/offline.html");

    expect(resposta.status).toBe(200);
    expect(resposta.text).toContain("Sem conexão");
    // Ни токена формы, ни данных человека: страница одна на всех и лежит
    // в кэше устройства.
    expect(resposta.text).not.toContain("_csrf");
    expect(resposta.text).not.toMatch(/<form/);
  });

  it("список кэшируемого — разрешительный, а не запретительный", async () => {
    /*
     * Главное свойство. Запретительный список рано или поздно пропустит
     * новый приватный маршрут — забыть добавить строку легче, чем забыть
     * разрешить. Проверяется буквально: функция решает по «начинается с»,
     * и приватные пути под неё не подходят.
     */
    // Функцию берём из самого файла воркера: переписать её здесь значило бы
    // проверять копию, а разойтись они могут молча.
    const corpo = /function cacheavel\(pathname\) \{([\s\S]*?)\n\}/.exec(FONTE)?.[1];
    expect(corpo, "не удалось найти cacheavel в sw.js").toBeTruthy();
    const cacheavel = new Function("pathname", corpo as string) as (
      p: string,
    ) => boolean;

    for (const publico of ["/css/main.css", "/js/app.js", "/icons/icon-192.png"]) {
      expect(cacheavel(publico), publico).toBe(true);
    }

    for (const privado of [
      "/caso/RB-ABC123",
      "/documentos/abc",
      "/minha-conta",
      "/admin",
      "/entrar",
      "/",
      "/sobre",
    ]) {
      expect(cacheavel(privado), privado).toBe(false);
    }
  });

  it("страницы не кладутся в кэш ни при каком исходе", async () => {
    // Страница несёт токен формы, привязанный к сессии, а страница дела —
    // ещё и чужие персональные данные.
    const navegacao = FONTE.slice(FONTE.indexOf('request.mode === "navigate"'));
    const ateOFim = navegacao.slice(0, navegacao.indexOf("if (!cacheavel"));

    expect(ateOFim).toContain("fetch(request)");
    expect(ateOFim).toContain("/offline.html");
    // Ни одной записи в кэш в ветке переходов.
    expect(ateOFim).not.toContain("cache.put");
    expect(ateOFim).not.toContain("cache.add");
  });

  it("меняющие запросы не перехватываются", async () => {
    expect(FONTE).toContain('request.method !== "GET"');
  });

  it("чужие домены не перехватываются", async () => {
    expect(FONTE).toContain("url.origin !== self.location.origin");
  });

  it("страница регистрирует воркер", async () => {
    const script = await request(harness.app).get("/js/app.js");
    expect(script.status).toBe(200);
    expect(script.text).toContain('navigator.serviceWorker.register("/sw.js")');
  });

  it("всё, что кладётся при установке, действительно отдаётся", async () => {
    // Иначе установка тихо положит в кэш 404, и страница «нет сети» будет
    // голой ровно тогда, когда она нужна.
    const lista = /const PRECACHE = \[([\s\S]*?)\];/.exec(FONTE)?.[1] ?? "";
    const urls = [...lista.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const arquivo = await request(harness.app).get(url);
      expect(arquivo.status, url).toBe(200);
    }
  });
});
