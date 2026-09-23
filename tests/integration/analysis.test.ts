import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Весь путь анализа: кнопка → сервис → провайдер → валидация → сохранение →
 * страница. Сеть подменена: проверяем нашу логику, а не чужой API.
 */
let harness: Harness;

function stub(reply: unknown, calls: Array<Record<string, unknown>> = []): ResponsesLike {
  return {
    responses: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return reply as never;
      },
    },
  };
}

function jsonReply(payload: unknown) {
  return {
    output_text: JSON.stringify(payload),
    usage: { input_tokens: 120, output_tokens: 40 },
  };
}

const CLASSIFICATION_HIGH = {
  category: "PRODUTO_NAO_RECEBIDO",
  subcategory: "entrega atrasada",
  confidence: 0.91,
  missing_information: ["Número do pedido"],
  recommended_questions: [],
  risk_flags: ["Prazo de entrega vencido"],
};

const DESCRIPTION = "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.";

async function setupCase(): Promise<{ cookies: string[]; publicId: string }> {
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

async function analisar(cookies: string[], publicId: string, tipo: string) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/analisar`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, tipo });
}

function useOpenAi() {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
}

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("без настроенного AI (§79)", () => {
  beforeEach(() => {
    resetConfigCache();
    resetAiProviderCache();
    harness = createHarness();
  });

  it("говорит прямо, что анализа не было", async () => {
    const { cookies, publicId } = await setupCase();
    const response = await analisar(cookies, publicId, "classificar");

    expect(response.status).toBe(303);
    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não está configurada",
    );
  });

  it("не сохраняет пустого разбора", async () => {
    const { cookies, publicId } = await setupCase();
    await analisar(cookies, publicId, "classificar");

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    // Заглушка не должна оставлять следов, похожих на результат модели.
    expect(page.text).not.toContain("Entendemos sua situação");
    expect(page.text).not.toContain("Informação gerada por inteligência artificial");
  });
});

describe("классификация через OpenAI", () => {
  beforeEach(() => {
    useOpenAi();
    harness = createHarness();
  });

  it("показывает результат и обязательный дисклеймер", async () => {
    setOpenAiClient(stub(jsonReply(CLASSIFICATION_HIGH)));
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "classificar");
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Entendemos sua situação");
    expect(page.text).toContain("PRODUTO_NAO_RECEBIDO");
    expect(page.text).toContain("91%");
    expect(page.text).toContain("Número do pedido");
    // §4: под существенным ответом AI дисклеймер обязателен.
    expect(page.text).toContain("Informação gerada por inteligência artificial");
  });

  it("уверенная классификация меняет категорию дела", async () => {
    setOpenAiClient(stub(jsonReply(CLASSIFICATION_HIGH)));
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "classificar");

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.category).toBe("PRODUTO_NAO_RECEBIDO");
    expect(stored?.status).toBe("EM_ANALISE");
  });

  it("неуверенная классификация категорию не меняет (§87)", async () => {
    // Неверная категория с виду уверенного ответа уводит дело не туда,
    // и заметить это потом некому.
    setOpenAiClient(stub(jsonReply({ ...CLASSIFICATION_HIGH, confidence: 0.2 })));
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "classificar");

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.category).toBeNull();
    expect(stored?.status).toBe("NOVO");

    // Но сам разбор пользователю показывается — как предположение.
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("20%");
  });

  it("ответ не по схеме до пользователя не доходит", async () => {
    setOpenAiClient(stub(jsonReply({ category: "CATEGORIA_INVENTADA", confidence: 2 })));
    const { cookies, publicId } = await setupCase();

    const response = await analisar(cookies, publicId, "classificar");
    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "Não foi possível concluir",
    );

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).not.toContain("CATEGORIA_INVENTADA");
  });

  it("повторное открытие страницы не запускает новый вызов модели", async () => {
    // Иначе обновление страницы стоило бы денег на каждом нажатии F5.
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(jsonReply(CLASSIFICATION_HIGH), calls));
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "classificar");
    expect(calls).toHaveLength(1);

    await request(harness.app).get(`/caso/${publicId}`).set("Cookie", cookies);
    await request(harness.app).get(`/caso/${publicId}`).set("Cookie", cookies);
    expect(calls).toHaveLength(1);
  });
});

describe("план действий", () => {
  beforeEach(() => {
    useOpenAi();
    harness = createHarness();
  });

  it("без официальных источников честно говорит об этом (§32)", async () => {
    setOpenAiClient(
      stub(
        jsonReply({
          steps: [
            {
              order: 1,
              title: "Entre em contato com a empresa",
              detail: "Registre o protocolo do atendimento.",
              source: "AI_SUGGESTION",
            },
          ],
          sources: [],
          uncertainties: ["Não foi possível confirmar o prazo em fonte oficial."],
        }),
      ),
    );
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "plano");
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Entre em contato com a empresa");
    expect(page.text).toContain("Não foi possível confirmar essa informação");
    // Шаг помечен как предположение, а не как требование закона (§5).
    expect(page.text).toContain("Sugestão da IA");
  });
});

describe("мессаж для компании", () => {
  beforeEach(() => {
    useOpenAi();
    harness = createHarness();
  });

  it("показывает текст и предупреждения", async () => {
    setOpenAiClient(
      stub(
        jsonReply({
          subject: "Pedido não recebido",
          body: "Comprei em 10/09 e não recebi. Peço a entrega ou a devolução.",
          facts_used: ["compra em 10/09"],
          warnings: ["Preencha [número do pedido] antes de enviar."],
        }),
      ),
    );
    const { cookies, publicId } = await setupCase();

    await analisar(cookies, publicId, "rascunho");
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Pedido não recebido");
    expect(page.text).toContain("[número do pedido]");
    // Ответственность за отправку остаётся на пользователе (§3).
    expect(page.text).toContain("O envio é feito por você");
  });
});

describe("доступ к анализу", () => {
  beforeEach(() => {
    useOpenAi();
    harness = createHarness();
  });

  it("чужое дело анализировать нельзя", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(jsonReply(CLASSIFICATION_HIGH), calls));
    const { publicId } = await setupCase();

    const bob = await login(harness, "21987654321");

    // Токен берём со своей страницы Боба: со страницы 404 его взять негде,
    // и тогда запрос отсекал бы CSRF — то есть проверялась бы не та защита.
    const own = await openPage(harness.app, "/minha-conta", bob);
    const response = await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", own.cookies)
      .type("form")
      .send({ _csrf: own.token, tipo: "classificar" });

    expect(response.status).toBe(404);
    // И главное: вызова модели по чужому делу не было.
    expect(calls).toHaveLength(0);
  });

  it("без входа анализировать нельзя", async () => {
    const { publicId } = await setupCase();
    const response = await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .type("form")
      .send({ tipo: "classificar" });

    // CSRF отсекает раньше авторизации — до модели запрос не доходит.
    expect([302, 403]).toContain(response.status);
  });
});
