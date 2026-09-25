import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Дело разбирается само (§3).
 *
 * Главная обещает три шага подряд, а страница дела до сих пор показывала
 * четыре одинаковые кнопки и молчала о том, что у них есть порядок.
 */
let harness: Harness;

const DESCRIPTION = "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.";

const RESPOSTAS: Record<string, unknown> = {
  CLASSIFICACAO: {
    category: "PRODUTO_NAO_RECEBIDO",
    subcategory: "entrega atrasada",
    confidence: 0.91,
    missing_information: [],
    recommended_questions: [],
    risk_flags: [],
  },
};

/** Клиент, отвечающий по очереди заготовленными ответами. */
function clienteComFila(fila: unknown[], chamadas: unknown[] = []): ResponsesLike {
  return {
    responses: {
      async create(body: Record<string, unknown>) {
        chamadas.push(body);
        const payload = fila.shift() ?? {};
        return {
          output_text: JSON.stringify(payload),
          usage: { input_tokens: 100, output_tokens: 30 },
        } as never;
      },
    },
  };
}

function usarOpenAi() {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
}

async function criarCaso(): Promise<{ cookies: string[]; publicId: string }> {
  const cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1];
  if (!publicId) throw new Error("дело не создано");
  return { cookies, publicId };
}

beforeEach(() => {
  resetConfigCache();
  resetAiProviderCache();
  harness = createHarness();
});

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("разбор дела идёт сам", () => {
  it("новое дело сразу показывает первый шаг, а не четыре кнопки", async () => {
    usarOpenAi();
    const { cookies, publicId } = await criarCaso();

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(pagina.status).toBe(200);
    // Шаги названы словами, и видно, какой идёт сейчас. Счётчика «Passo N
    // de 4» больше нет: список этапов говорит то же самое, но по существу —
    // что именно уже сделано, а не сколько штук.
    expect(pagina.text).toContain("Entendendo sua situação");
    expect(pagina.text).toContain("Montando seu plano de ação");
    expect(pagina.text).toMatch(
      /analise__passo--agora[^>]*>\s*<span[^>]*>●/,
    );
    // Ни один шаг ещё не сделан.
    expect(pagina.text).not.toContain("analise__passo--feito");
    // Форма следующего шага готова к отправке.
    expect(pagina.text).toMatch(/data-auto-analise/);
    expect(pagina.text).toMatch(/name="tipo" value="classificar"/);
  });

  it("после шага страница предлагает следующий", async () => {
    usarOpenAi();
    const { cookies, publicId } = await criarCaso();
    setOpenAiClient(clienteComFila([RESPOSTAS.CLASSIFICACAO]));

    const pagina = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const feito = await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, tipo: "classificar" });

    expect(feito.status).toBe(303);

    const depois = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(depois.text).toContain("Vendo o que ainda falta");
    // Пройденный шаг отмечен сделанным — это и есть «видно, где мы».
    expect(depois.text).toContain("analise__passo--feito");
    expect(depois.text).toMatch(/name="tipo" value="perguntas"/);
  });

  it("сорвавшийся шаг останавливает разбор и называет причину", async () => {
    // Иначе страница ходила бы по кругу, платя за каждое обращение к модели.
    const { cookies, publicId } = await criarCaso();

    const pagina = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const falhou = await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token, tipo: "classificar" });

    expect(falhou.status).toBe(303);
    expect(falhou.headers.location).toContain("analise=");

    const depois = await request(harness.app)
      .get(falhou.headers.location as string)
      .set("Cookie", cookies);

    // Причина названа, автопродолжения нет, вернулись обычные кнопки.
    expect(depois.text).toContain("não está configurada");
    expect(depois.text).not.toMatch(/data-auto-analise\b/);
    expect(depois.text).toContain("O que falta saber");
  });

  it("непринятый файл разбор не останавливает", async () => {
    // Это разные беды: предупреждение о вложении и сорвавшийся разбор.
    usarOpenAi();
    const { cookies, publicId } = await criarCaso();

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}?aviso=${encodeURIComponent("Arquivo não aceito")}`)
      .set("Cookie", cookies);

    expect(pagina.text).toContain("Arquivo não aceito");
    expect(pagina.text).toMatch(/data-auto-analise/);
  });
});
