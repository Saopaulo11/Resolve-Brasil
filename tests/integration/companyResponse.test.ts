import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { ELF_BYTES, PNG_BYTES } from "../helpers/files";

let harness: Harness;
let cookies: string[];
let publicId: string;

const ANALYSIS = {
  what_company_said: "A empresa informou que o pedido foi despachado.",
  what_it_means:
    "A empresa afirma ter enviado, mas não apresentou código de rastreio.",
  what_is_missing: ["Código de rastreio", "Data prevista de entrega"],
  possible_next_action: "Pedir o código de rastreio e registrar o protocolo.",
  suggested_reply: "Agradeço o retorno. Poderiam informar o código de rastreio?",
};

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
    usage: { input_tokens: 150, output_tokens: 60 },
  };
}

function useOpenAi() {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
}

async function setup() {
  harness = createHarness();
  cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({
      _csrf: home.token,
      description: "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.",
    });
  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

async function enviarTexto(texto: string) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/resposta`)
    .set("Cookie", page.cookies)
    .field("_csrf", page.token)
    .field("texto", texto);
}

async function enviarArquivo(
  bytes: Buffer,
  filename: string,
  contentType: string,
  texto = "",
) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/resposta`)
    .set("Cookie", page.cookies)
    .field("_csrf", page.token)
    .field("texto", texto)
    .attach("arquivo", bytes, { filename, contentType });
}

const RESPOSTA =
  "Prezado cliente, informamos que seu pedido ja foi despachado. Atenciosamente.";

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("ответ вставлен текстом", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
  });

  it("показывает разбор по всем четырём пунктам (§35)", async () => {
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarTexto(RESPOSTA);

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("O que a empresa respondeu");
    expect(page.text).toContain("foi despachado");
    expect(page.text).toContain("O que isso significa");
    expect(page.text).toContain("Código de rastreio");
    expect(page.text).toContain("Próxima ação possível");
    expect(page.text).toContain("Resposta sugerida");
    expect(page.text).toContain("Informação gerada por inteligência artificial");
  });

  it("следующий шаг помечен как предположение, а не обязанность", async () => {
    // §3: не обещаем исход и не выдаём догадку за требование к компании.
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarTexto(RESPOSTA);

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("Sugestão da IA");
  });

  it("переводит дело в статус «ответ получен»", async () => {
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarTexto(RESPOSTA);

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.status).toBe("RESPOSTA_RECEBIDA");
  });

  it("добавляет событие в хронологию", async () => {
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarTexto(RESPOSTA);

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("Resposta da empresa recebida");
  });

  it("передаёт модели и текст ответа, и контекст дела", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(jsonReply(ANALYSIS), calls));
    await enviarTexto(RESPOSTA);

    const sent = String(calls[0]?.input);
    expect(sent).toContain("despachado");
    expect(sent).toContain(publicId);
  });

  it("слишком короткий текст не принимается и ничего не меняет", async () => {
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    const response = await enviarTexto("ok");

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "Cole o texto da resposta",
    );

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.status).toBe("NOVO");
  });

  it("если разбор не удался, сам ответ не теряется", async () => {
    // Человек уже принёс ответ — потерять его из-за сбоя модели нельзя.
    setOpenAiClient(stub(jsonReply({ what_company_said: 123 })));

    const response = await enviarTexto(RESPOSTA);
    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "Recebemos a resposta",
    );

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.status).toBe("RESPOSTA_RECEBIDA");

    const messages = await harness.cases.listMessages(stored!.id);
    expect(messages.some((m) => m.direction === "USER")).toBe(true);
  });

  it("не показывает раздела ответа, пока его нет", async () => {
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).not.toContain("O que a empresa respondeu");
  });
});

describe("ответ прислан файлом", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
  });

  it("файл сохраняется как документ дела", async () => {
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarArquivo(PNG_BYTES, "print.png", "image/png");

    const stored = await harness.cases.findByPublicId(publicId);
    const docs = await harness.documents.listForCase(stored!.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.kind).toBe("RESPOSTA_DA_EMPRESA");
  });

  it("сам файл уходит модели", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(jsonReply(ANALYSIS), calls));
    await enviarArquivo(PNG_BYTES, "print.png", "image/png");

    const input = calls[0]?.input as Array<{ content: Array<Record<string, unknown>> }>;
    const part = input[0]?.content.find((item) => item.type === "input_image");
    expect(part).toBeDefined();
    expect(String(part?.image_url)).toContain("data:image/png;base64,");
  });

  it("файл важнее текста, если прислано и то и другое", async () => {
    // Текст мог остаться в поле с прошлой попытки; приложенный файл — нет.
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    await enviarArquivo(PNG_BYTES, "print.png", "image/png", RESPOSTA);

    const stored = await harness.cases.findByPublicId(publicId);
    const docs = await harness.documents.listForCase(stored!.id);
    expect(docs).toHaveLength(1);
  });

  it("подделанный файл проходит ту же проверку, что и обычный документ", async () => {
    // Отдельной «облегчённой» дороги для файлов здесь нет.
    setOpenAiClient(stub(jsonReply(ANALYSIS)));
    const response = await enviarArquivo(ELF_BYTES, "print.png", "image/png");

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não corresponde",
    );

    const stored = await harness.cases.findByPublicId(publicId);
    expect(await harness.documents.listForCase(stored!.id)).toHaveLength(0);
    expect(stored?.status).toBe("NOVO");
  });
});

describe("без настроенного AI (§79)", () => {
  beforeEach(async () => {
    resetConfigCache();
    resetAiProviderCache();
    await setup();
  });

  it("говорит прямо и ничего не сохраняет", async () => {
    const response = await enviarTexto(RESPOSTA);

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não está configurada",
    );

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.status).toBe("NOVO");
    expect(await harness.cases.listMessages(stored!.id)).toHaveLength(0);
  });
});

describe("доступ", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
  });

  it("чужой не может прислать ответ в это дело", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(jsonReply(ANALYSIS), calls));

    const bob = await login(harness, "21987654321");
    const own = await openPage(harness.app, "/minha-conta", bob);

    const response = await request(harness.app)
      .post(`/caso/${publicId}/resposta`)
      .set("Cookie", own.cookies)
      .field("_csrf", own.token)
      .field("texto", RESPOSTA);

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);

    const stored = await harness.cases.findByPublicId(publicId);
    expect(stored?.status).toBe("NOVO");
  });
});
