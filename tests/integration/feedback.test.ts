import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Оценка ответов AI (§52).
 *
 * Проверяется не кнопка, а то, ради чего она существует: оценка привязана к
 * конкретному сообщению, чужое сообщение оценить нельзя, а одно мнение не
 * превращается в несколько нажатием дважды.
 */
let harness: Harness;

const DESCRIPTION = "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.";

const CLASSIFICATION = {
  category: "PRODUTO_NAO_RECEBIDO",
  subcategory: "entrega atrasada",
  confidence: 0.91,
  missing_information: [],
  recommended_questions: [],
  risk_flags: [],
};

function stub(reply: unknown): ResponsesLike {
  return {
    responses: {
      async create() {
        return reply as never;
      },
    },
  };
}

function useOpenAi() {
  resetConfigCache();
  resetAiProviderCache();
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "chave-de-teste-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
}

/** Дело с одним разбором: только так на странице появляется, что оценивать. */
async function casoComAnalise(phone = "11987654321") {
  const cookies = await login(harness, phone);
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1];
  if (!publicId) throw new Error("дело не создано");

  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  await request(harness.app)
    .post(`/caso/${publicId}/analisar`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, tipo: "classificar" });

  return { cookies, publicId };
}

async function avaliar(
  cookies: string[],
  publicId: string,
  body: Record<string, string>,
) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/avaliar`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, ...body });
}

async function idDaClassificacao(caseId: string): Promise<string> {
  const messages = await harness.cases.listMessages(caseId);
  const message = messages.find((item) => item.type === "CLASSIFICACAO");
  if (!message) throw new Error("разбора нет");
  return message.id;
}

beforeEach(() => {
  useOpenAi();
  harness = createHarness();
  setOpenAiClient(
    stub({
      output_text: JSON.stringify(CLASSIFICATION),
      usage: { input_tokens: 120, output_tokens: 40 },
    }),
  );
});

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("оценка ответа AI (§52)", () => {
  it("форма оценки появляется под разбором", async () => {
    const { cookies, publicId } = await casoComAnalise();
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Essa orientação ajudou?");
  });

  it("сохраняет оценку вместе с причиной", async () => {
    const { cookies, publicId } = await casoComAnalise();
    const caso = await harness.cases.findByPublicId(publicId);
    const mensagem = await idDaClassificacao(caso!.id);

    const response = await avaliar(cookies, publicId, {
      mensagem,
      avaliacao: "NAO",
      motivo: "INFORMACAO_INCORRETA",
      comentario: "A categoria não corresponde",
    });

    expect(response.status).toBe(303);

    const [registro] = await harness.feedback.listRecent(10);
    expect(registro?.messageId).toBe(mensagem);
    expect(registro?.rating).toBe("NAO");
    expect(registro?.reason).toBe("INFORMACAO_INCORRETA");
    expect(registro?.comment).toBe("A categoria não corresponde");
  });

  it("у положительной оценки причины не остаётся", async () => {
    // Иначе «ajudou» с причиной «informação incorreta» попадёт в отчёт и
    // будет считаться жалобой.
    const { cookies, publicId } = await casoComAnalise();
    const caso = await harness.cases.findByPublicId(publicId);

    await avaliar(cookies, publicId, {
      mensagem: await idDaClassificacao(caso!.id),
      avaliacao: "SIM",
      motivo: "INFORMACAO_INCORRETA",
    });

    const [registro] = await harness.feedback.listRecent(10);
    expect(registro?.rating).toBe("SIM");
    expect(registro?.reason).toBeNull();
  });

  it("повторное нажатие не создаёт второй записи", async () => {
    const { cookies, publicId } = await casoComAnalise();
    const caso = await harness.cases.findByPublicId(publicId);
    const mensagem = await idDaClassificacao(caso!.id);

    await avaliar(cookies, publicId, { mensagem, avaliacao: "SIM" });
    await avaliar(cookies, publicId, { mensagem, avaliacao: "NAO" });

    expect(await harness.feedback.listRecent(10)).toHaveLength(1);
    expect((await harness.feedback.countByRating()).sim).toBe(1);
  });

  it("после оценки форма больше не показывается", async () => {
    const { cookies, publicId } = await casoComAnalise();
    const caso = await harness.cases.findByPublicId(publicId);

    await avaliar(cookies, publicId, {
      mensagem: await idDaClassificacao(caso!.id),
      avaliacao: "SIM",
    });

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).not.toContain("Essa orientação ajudou?");
    expect(page.text).toContain("Obrigado pela avaliação");
  });

  it("оценивается каждый вид ответа отдельно", async () => {
    // Три блока страницы — три формы. Общая оценка «понравилось ли всё»
    // не сказала бы, что именно чинить.
    const { cookies, publicId } = await casoComAnalise();

    setOpenAiClient(
      stub({
        output_text: JSON.stringify({
          steps: [
            {
              order: 1,
              title: "Entre em contato com a empresa",
              detail: "Registre o protocolo do atendimento.",
              source: "AI_SUGGESTION",
            },
          ],
          sources: [],
          uncertainties: [],
        }),
        usage: { input_tokens: 100, output_tokens: 60 },
      }),
    );

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, tipo: "plano" });

    const depois = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    const formas = depois.text.match(/Essa orientação ajudou\?/g) ?? [];
    expect(formas).toHaveLength(2);

    // Оценка разбора не гасит форму под планом: это разные ответы.
    const caso = await harness.cases.findByPublicId(publicId);
    await avaliar(cookies, publicId, {
      mensagem: await idDaClassificacao(caso!.id),
      avaliacao: "SIM",
    });

    const final = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect((final.text.match(/Essa orientação ajudou\?/g) ?? [])).toHaveLength(1);
    expect(final.text).toContain("Obrigado pela avaliação");
  });

  it("нельзя оценить сообщение чужого дела", async () => {
    const alice = await casoComAnalise("11987654321");
    const bob = await casoComAnalise("11912345678");

    const casoDeAlice = await harness.cases.findByPublicId(alice.publicId);
    const mensagemDeAlice = await idDaClassificacao(casoDeAlice!.id);

    // Боб подставляет идентификатор чужого сообщения в форму своего дела.
    const response = await avaliar(bob.cookies, bob.publicId, {
      mensagem: mensagemDeAlice,
      avaliacao: "NAO",
    });

    expect(response.status).toBe(404);
    expect(await harness.feedback.listRecent(10)).toHaveLength(0);
  });

  it("без входа оценка не принимается", async () => {
    const { publicId } = await casoComAnalise();

    const page = await openPage(harness.app, "/entrar");
    const response = await request(harness.app)
      .post(`/caso/${publicId}/avaliar`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, mensagem: "qualquer", avaliacao: "SIM" });

    // Страж входа срабатывает раньше контроллера — до записи дело не доходит.
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/entrar");
    expect(await harness.feedback.listRecent(10)).toHaveLength(0);
  });
});
