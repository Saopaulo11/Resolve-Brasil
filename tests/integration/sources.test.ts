import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { importCandidates } from "../../src/sources/sourceService";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

let harness: Harness;
let cookies: string[];
let publicId: string;

const SOURCE = {
  organization: "Consumidor.gov.br",
  title: "Consumidor.gov.br — plataforma oficial",
  url: "https://www.consumidor.gov.br/",
  category: "consumidor",
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

function planReply(sources: Array<Record<string, unknown>>) {
  return {
    output_text: JSON.stringify({
      steps: [
        {
          order: 1,
          title: "Registre a reclamação no canal oficial",
          detail: "Guarde o protocolo do atendimento.",
          source: "OFFICIAL_SOURCE",
        },
      ],
      sources,
      uncertainties: [],
    }),
    usage: { input_tokens: 100, output_tokens: 30 },
  };
}

async function setup() {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";

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

async function gerarPlano() {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/analisar`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, tipo: "plano" });
}

async function verificarFonte() {
  const stored = await harness.sources.findByUrl(SOURCE.url);
  await harness.sources.markVerified(stored!.id, new Date());
}

beforeEach(setup);

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("источники в плане действий (§29–§32)", () => {
  it("непроверенный источник модели не показывается", async () => {
    // Импортирован, но никто его не открывал — значит, его нет.
    await importCandidates([SOURCE]);

    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(planReply([]), calls));

    await gerarPlano();

    expect(String(calls[0]?.instructions)).toContain("nenhuma fonte oficial");
    expect(String(calls[0]?.instructions)).not.toContain(SOURCE.url);
  });

  it("проверенный источник попадает в запрос", async () => {
    await importCandidates([SOURCE]);
    await verificarFonte();

    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(planReply([]), calls));

    await gerarPlano();
    expect(String(calls[0]?.instructions)).toContain(SOURCE.url);
  });

  it("показывается с датой последней проверки", async () => {
    // §31: без даты ссылка выглядит вечно актуальной.
    await importCandidates([SOURCE]);
    await verificarFonte();

    setOpenAiClient(
      stub(
        planReply([
          { organization: SOURCE.organization, title: SOURCE.title, url: SOURCE.url },
        ]),
      ),
    );

    await gerarPlano();
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain(SOURCE.url);
    expect(page.text).toContain("Verificada em");
    expect(page.text).toContain("Fonte oficial");
  });

  it("выдуманная ссылка отбрасывается", async () => {
    // Выдуманный gov.br в плане действий опаснее всего: там он выглядит
    // как подтверждение процедуры.
    await importCandidates([SOURCE]);
    await verificarFonte();

    setOpenAiClient(
      stub(
        planReply([
          {
            organization: "gov.br",
            title: "Procedimento inventado",
            url: "https://www.gov.br/pagina-que-ninguem-verificou",
          },
        ]),
      ),
    );

    await gerarPlano();
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).not.toContain("pagina-que-ninguem-verificou");
    expect(page.text).toContain("Não foi possível confirmar essa informação");
  });

  it("без единого источника план честно говорит об этом (§32)", async () => {
    setOpenAiClient(stub(planReply([])));

    await gerarPlano();
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Não foi possível confirmar essa informação");
  });

  it("устаревшая проверка снимает источник с использования", async () => {
    await importCandidates([SOURCE]);
    const stored = await harness.sources.findByUrl(SOURCE.url);
    await harness.sources.markVerified(
      stored!.id,
      new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    );

    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub(planReply([]), calls));

    await gerarPlano();
    expect(String(calls[0]?.instructions)).toContain("nenhuma fonte oficial");
  });
});
