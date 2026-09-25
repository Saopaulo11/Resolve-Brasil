import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app";
import { resetConfigCache } from "../../src/config/env";
import { createMemoryStores } from "../../src/users/memoryStoreSet";
import { setStores } from "../../src/users/storeRegistry";

/**
 * Подписанные куки за платформенным адаптером.
 *
 * На Vercel приложение получает запрос не напрямую: адаптер платформы сам
 * разбирает кое-что заранее и кладёт в запрос `cookies`. А cookie-parser
 * начинается со строки `if (req.cookies) return next()` — увидев готовое
 * поле, он не делает ничего и, главное, не проставляет `req.secret`.
 *
 * Дальше всё разваливается тихо: `req.signedCookies` не появляется вовсе,
 * а первая же запись подписанной куки бросает
 * «cookieParser("secret") required for signed cookies». На боевом стенде это
 * выглядело так: дело в базе создавалось, вложения прикреплялись, а человек
 * получал «Algo deu errado» — обрыв приходился ровно на куку с номером дела,
 * без которой гость своё дело потом и не открыл бы.
 *
 * Локально этого не видно никогда: там перед Express никого нет и
 * cookie-parser работает. Поэтому проверка ставит перед приложением
 * подставной адаптер — ровно с тем поведением, что у платформы.
 */

const salvo = { ...process.env };

/**
 * Приложение за адаптером, который уже разобрал куки, как это делает Vercel.
 *
 * Разбирает по-настоящему, из заголовка: подставить пустой объект было бы
 * слишком грубо — тогда и проверка CSRF не нашла бы своей куки, и запрос
 * отвергался бы раньше, чем дело дошло бы до подписанной. На стенде куки
 * именно разобраны, поэтому CSRF там проходит, а спотыкается только подпись.
 */
function atrasDeAdaptador() {
  const fora = express();
  fora.use((req, _res, next) => {
    const cru = req.headers.cookie ?? "";
    const analisadas: Record<string, string> = Object.create(null);
    for (const parte of cru.split(";")) {
      const corte = parte.indexOf("=");
      if (corte === -1) continue;
      const nome = parte.slice(0, corte).trim();
      if (nome) analisadas[nome] = decodeURIComponent(parte.slice(corte + 1).trim());
    }
    (req as express.Request & { cookies?: unknown }).cookies = analisadas;
    next();
  });
  fora.use(createApp());
  return fora;
}

function producao() {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://u:p@localhost:6543/postgres";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.APP_URL = "https://exemplo.test";
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
  resetConfigCache();
  setStores(createMemoryStores());
}

async function criarComoConvidado(app: express.Express) {
  const pagina = await request(app).get("/");
  const token = /name="_csrf" value="([^"]+)"/.exec(pagina.text)?.[1] ?? "";
  const cookies = (pagina.headers["set-cookie"] as unknown as string[]) ?? [];

  return request(app)
    .post("/caso/novo")
    .set("Cookie", cookies)
    .type("form")
    .send({
      _csrf: token,
      description:
        "Comprei um produto pela internet, o prazo de entrega terminou e " +
        "até agora não recebi o pedido.",
    });
}

afterEach(() => {
  process.env = { ...salvo };
  resetConfigCache();
});

describe("подписанные куки за адаптером платформы", () => {
  it("гость заводит дело и уходит на него, а не на «Algo deu errado»", async () => {
    producao();

    const resposta = await criarComoConvidado(atrasDeAdaptador());

    expect(resposta.text).not.toContain("Algo deu errado");
    expect(resposta.status).toBe(303);
    expect(resposta.headers.location).toMatch(/^\/caso\/RB-[A-Z2-9]{6}$/);
  });

  it("кука с номером дела всё-таки подписывается", async () => {
    producao();

    const resposta = await criarComoConvidado(atrasDeAdaptador());
    const cookies = (resposta.headers["set-cookie"] as unknown as string[]) ?? [];
    const pendente = cookies.find((c) => c.startsWith("rb_caso="));

    expect(pendente).toBeDefined();
    // Подпись: значение не равно самому номеру дела, иначе его можно подменить.
    expect(pendente).toContain("rb_caso=s%3A");
    expect(pendente).toContain("HttpOnly");
  });

  it("страница входа тоже поднимается — она читает подписанную куку", async () => {
    producao();

    const resposta = await request(atrasDeAdaptador()).get("/entrar");

    expect(resposta.status).toBe(200);
    expect(resposta.text).not.toContain("Algo deu errado");
  });
});
