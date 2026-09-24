import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import handler from "../../src/app";
import { createHarness } from "../helpers/auth";

/**
 * Точка входа для платформы (§68).
 *
 * Vercel не запускает npm start: он сам выбирает файл и ждёт от него
 * приложение или обработчик в экспорте по умолчанию. Этот экспорт не
 * используется ни одним тестом приложения и ни одной командой — и ровно
 * поэтому ломается молча. Сломался он так: сборка зелёная, все проверки
 * проходят, а на сайте пятисотка на каждом запросе.
 */
beforeEach(() => {
  createHarness();
});

describe("экспорт по умолчанию из src/app", () => {
  it("это функция-обработчик, а не фабрика", () => {
    // Фабрика createApp() тоже функция, но платформа зовёт экспорт с
    // запросом и ответом. Разницу видно по числу аргументов.
    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(2);
  });

  it("обслуживает страницы", async () => {
    const resposta = await request(handler).get("/sobre");

    expect(resposta.status).toBe(200);
    expect(resposta.text).toContain("<html lang=\"pt-BR\">");
  });

  it("переживает несколько запросов на одном экземпляре", async () => {
    // Приложение строится лениво — второй запрос не должен собирать его заново.
    const primeira = await request(handler).get("/");
    const segunda = await request(handler).get("/termos");

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
  });
});
