import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { PDF_BYTES, PNG_BYTES } from "../helpers/files";

let harness: Harness;
let cookies: string[];
let publicId: string;

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

const EXTRACTION = {
  fields: [
    { field: "company", value: "Loja Exemplo", confidence: 0.94 },
    { field: "amount", value: "R$ 349,90", confidence: 0.88 },
  ],
  notes: [],
};

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

async function upload(bytes: Buffer, filename: string, contentType: string) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/documentos`)
    .set("Cookie", page.cookies)
    .field("_csrf", page.token)
    .field("tipo", "COMPROVANTE_PIX")
    .attach("arquivo", bytes, { filename, contentType });
}

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("загрузка документа", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
  });

  it("принимает PDF и показывает его в деле", async () => {
    const response = await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
    expect(response.status).toBe(303);

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("comprovante.pdf");
    expect(page.text).toContain("Comprovante de Pix");
  });

  it("принимает картинку", async () => {
    const response = await upload(PNG_BYTES, "print.png", "image/png");
    expect(response.status).toBe(303);

    const documents = await harness.documents.listForCase(
      (await harness.cases.findByPublicId(publicId))!.id,
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]?.mimeType).toBe("image/png");
  });

  it("не кладёт имя пользовательского файла в путь хранения", async () => {
    // Иначе «../../etc/passwd.pdf» стало бы частью пути.
    await upload(PDF_BYTES, "../../etc/passwd.pdf", "application/pdf");

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    expect(documents[0]?.storageKey).not.toContain("passwd");
    expect(documents[0]?.storageKey).not.toContain("..");
    expect(documents[0]?.storageKey).toMatch(/^cases\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/);
  });

  it("считает контрольную сумму и отмечает, что проверки на вирусы не было", async () => {
    // Статус «не проверено» честнее отсутствия поля: потом будет видно,
    // какие файлы загружены до появления проверки.
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    expect(documents[0]?.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(documents[0]?.scanStatus).toBe("NAO_VERIFICADO");
  });

  it("записывает загрузку в журнал (§25)", async () => {
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
    const actions = harness.audit.entries.map((entry) => entry.action);
    expect(actions).toContain("document.upload");
  });

  it("добавляет событие в хронологию дела", async () => {
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("Documento enviado");
  });
});

describe("выдача документа", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
  });

  it("владелец получает файл", async () => {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);

    const response = await request(harness.app)
      .get(`/caso/${publicId}/documentos/${documents[0]?.id}`)
      .set("Cookie", cookies);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
  });

  it("файл отдаётся как вложение и не исполняется в нашем origin", async () => {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);

    const response = await request(harness.app)
      .get(`/caso/${publicId}/documentos/${documents[0]?.id}`)
      .set("Cookie", cookies);

    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    // Приватный файл не должен оседать в промежуточных кешах.
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("каждое обращение пишется в журнал (§51)", async () => {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);

    await request(harness.app)
      .get(`/caso/${publicId}/documentos/${documents[0]?.id}`)
      .set("Cookie", cookies);

    const reads = harness.audit.entries.filter((e) => e.action === "document.read");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.entityId).toBe(documents[0]?.id);
  });
});

describe("извлечение данных (§26)", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
  });

  async function documentId(): Promise<string> {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    return documents[0]!.id;
  }

  async function extrair() {
    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    return request(harness.app)
      .post(`/caso/${publicId}/documentos/${await documentId()}/extrair`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });
  }

  it("прикладывает сам файл к запросу", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub({ output_text: JSON.stringify(EXTRACTION) }, calls));

    await extrair();

    const input = calls[0]?.input as Array<{ content: Array<Record<string, unknown>> }>;
    const part = input[0]?.content.find((item) => item.type === "input_file");
    expect(part).toBeDefined();
    expect(String(part?.file_data)).toContain("data:application/pdf;base64,");
  });

  it("не разрешает провайдеру хранить документ", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setOpenAiClient(stub({ output_text: JSON.stringify(EXTRACTION) }, calls));

    await extrair();
    expect(calls[0]?.store).toBe(false);
  });

  it("извлечённое не становится фактом само по себе", async () => {
    setOpenAiClient(stub({ output_text: JSON.stringify(EXTRACTION) }));
    await extrair();

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const facts = await harness.facts.listForCase(caseRecord!.id);

    expect(facts).toHaveLength(2);
    for (const fact of facts) {
      expect(fact.status).toBe("UNCONFIRMED");
      // §5: это догадка модели, а не то, что сказал пользователь.
      expect(fact.source).toBe("AI_SUGGESTION");
    }
  });

  it("показывает данные как требующие подтверждения", async () => {
    setOpenAiClient(stub({ output_text: JSON.stringify(EXTRACTION) }));
    await extrair();

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("ainda não são");
    expect(page.text).toContain("Loja Exemplo");
    expect(page.text).toContain("Aguardando sua confirmação");
    expect(page.text).toContain("Informação gerada por inteligência artificial");
  });

  it("без ключа говорит прямо, что чтения не было", async () => {
    resetConfigCache();
    resetAiProviderCache();
    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;

    const response = await extrair();
    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não está configurada",
    );

    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(await harness.facts.listForCase(caseRecord!.id)).toHaveLength(0);
  });
});

describe("подтверждение фактов (§26)", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
    setOpenAiClient(stub({ output_text: JSON.stringify(EXTRACTION) }));

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    await request(harness.app)
      .post(`/caso/${publicId}/documentos/${documents[0]?.id}/extrair`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });
  });

  async function firstFactId(): Promise<string> {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const facts = await harness.facts.listForCase(caseRecord!.id);
    return facts[0]!.id;
  }

  async function decidir(factId: string, decisao: string, valor?: string) {
    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    return request(harness.app)
      .post(`/caso/${publicId}/fatos/${factId}`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, decisao, ...(valor ? { valor } : {}) });
  }

  it("подтверждение переводит факт в подтверждённые", async () => {
    const factId = await firstFactId();
    await decidir(factId, "confirmar");

    const fact = await harness.facts.findById(factId);
    expect(fact?.status).toBe("CONFIRMED");
    expect(fact?.confirmedAt).not.toBeNull();
  });

  it("исправление сохраняет значение пользователя", async () => {
    const factId = await firstFactId();
    await decidir(factId, "corrigir", "Loja Exemplo LTDA");

    const fact = await harness.facts.findById(factId);
    expect(fact?.status).toBe("USER_CORRECTED");
    expect(fact?.value).toBe("Loja Exemplo LTDA");
  });

  it("отклонённый факт исчезает со страницы", async () => {
    const factId = await firstFactId();
    await decidir(factId, "rejeitar");

    const fact = await harness.facts.findById(factId);
    expect(fact?.status).toBe("REJECTED");
    // У отклонённого не должно быть отметки подтверждения.
    expect(fact?.confirmedAt).toBeNull();

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).not.toContain("Loja Exemplo");
  });

  it("модели уходят только подтверждённые факты (§5)", async () => {
    // Неподтверждённая догадка модели не должна вернуться к ней же
    // как установленный факт — иначе она закрепится сама собой.
    const calls: Array<Record<string, unknown>> = [];
    const factId = await firstFactId();
    await decidir(factId, "confirmar");

    setOpenAiClient(
      stub(
        {
          output_text: JSON.stringify({
            category: "PRODUTO_NAO_RECEBIDO",
            subcategory: null,
            confidence: 0.9,
            missing_information: [],
            recommended_questions: [],
            risk_flags: [],
          }),
        },
        calls,
      ),
    );

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    await request(harness.app)
      .post(`/caso/${publicId}/analisar`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, tipo: "classificar" });

    const sent = String(calls[0]?.input);
    expect(sent).toContain("Loja Exemplo");
    // Второй факт остался неподтверждённым — его быть не должно.
    expect(sent).not.toContain("R$ 349,90");
  });
});

/**
 * §26, §85, §86.
 *
 * Раньше подтверждение оставалось только в списке фактов: дело не знало ни
 * компании, ни суммы. Из-за этого срез по компании не находил ни одного
 * дела, а отрасль в аналитике оставалась пустой не потому, что её не
 * определили, а потому, что компанию некуда было записать.
 */
describe("подтверждённые факты становятся полями дела", () => {
  beforeEach(async () => {
    // Без соли слепок в аналитику не пишется вовсе — и проверять было бы
    // нечего (§55).
    process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
    useOpenAi();
    await setup();
    await upload(PDF_BYTES, "comprovante.pdf", "application/pdf");
    setOpenAiClient(
      stub({
        output_text: JSON.stringify({
          fields: [
            { field: "company", value: "Loja Exemplo S.A.", confidence: 0.94 },
            { field: "amount", value: "R$ 349,90", confidence: 0.88 },
            { field: "payment_method", value: "Pix", confidence: 0.9 },
            { field: "purchase_date", value: "02/03/2026", confidence: 0.85 },
          ],
          notes: [],
        }),
      }),
    );

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    await request(harness.app)
      .post(`/caso/${publicId}/documentos/${documents[0]?.id}/extrair`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });
  });

  async function confirmarTodos() {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const facts = await harness.facts.listForCase(caseRecord!.id);

    for (const fact of facts) {
      const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
      await request(harness.app)
        .post(`/caso/${publicId}/fatos/${fact.id}`)
        .set("Cookie", page.cookies)
        .type("form")
        .send({ _csrf: page.token, decisao: "confirmar" });
    }
  }

  it("неподтверждённый факт полем дела не становится", async () => {
    // §5: догадка модели в поле выглядит ровно как факт, и отличить их
    // потом будет нечем.
    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(caseRecord?.companyName).toBeNull();
    expect(caseRecord?.amount).toBeNull();
  });

  it("подтверждение переносит компанию, сумму, оплату и дату", async () => {
    await confirmarTodos();

    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(caseRecord?.companyName).toBe("Loja Exemplo S.A.");
    expect(caseRecord?.amount).toBe("349.90");
    expect(caseRecord?.paymentMethod).toBe("PIX");
    expect(caseRecord?.purchaseDate?.toISOString().slice(0, 10)).toBe("2026-03-02");
  });

  it("компания заводится в справочнике в нормализованном виде", async () => {
    await confirmarTodos();

    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(caseRecord?.companyNormalized).toBe("loja exemplo");

    const empresa = await harness.companies.findByNormalized("loja exemplo");
    expect(empresa?.canonicalName).toBe("Loja Exemplo S.A.");
    // «Loja» — розница: компания сказала это о себе сама в названии (§86).
    expect(empresa?.industry).toBe("RETAIL");
  });

  it("компания и отрасль доезжают до аналитики", async () => {
    await confirmarTodos();

    const [slice] = await harness.analytics.listReal();
    expect(slice?.companyNormalized).toBe("loja exemplo");
    expect(slice?.industry).toBe("RETAIL");
    expect(slice?.amountBucket).not.toBeNull();
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("отклонение подтверждённого очищает поле", async () => {
    // Иначе поле осталось бы от прошлого решения, и человек не смог бы
    // убрать то, что сам же и подтвердил.
    await confirmarTodos();

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const facts = await harness.facts.listForCase(caseRecord!.id);
    const amountFact = facts.find((fact) => fact.field === "amount");

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    await request(harness.app)
      .post(`/caso/${publicId}/fatos/${amountFact!.id}`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, decisao: "rejeitar" });

    const depois = await harness.cases.findByPublicId(publicId);
    expect(depois?.amount).toBeNull();
    // Остальное при этом на месте.
    expect(depois?.companyName).toBe("Loja Exemplo S.A.");
  });
});

describe("несколько файлов за одну отправку", () => {
  beforeEach(async () => {
    useOpenAi();
    await setup();
  });

  it("принимает все и показывает их в деле", async () => {
    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos`)
      .set("Cookie", page.cookies)
      .field("_csrf", page.token)
      .field("tipo", "OUTRO")
      .attach("arquivo", PDF_BYTES, { filename: "nota.pdf", contentType: "application/pdf" })
      .attach("arquivo", PNG_BYTES, { filename: "foto.png", contentType: "image/png" });

    expect(resposta.status).toBe(303);

    const depois = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(depois.text).toContain("nota.pdf");
    expect(depois.text).toContain("foto.png");
  });

  it("непринятый файл не отменяет остальные", async () => {
    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos`)
      .set("Cookie", page.cookies)
      .field("_csrf", page.token)
      .field("tipo", "OUTRO")
      .attach("arquivo", PDF_BYTES, { filename: "nota.pdf", contentType: "application/pdf" })
      .attach("arquivo", Buffer.from("nao e imagem"), {
        filename: "falso.png",
        contentType: "image/png",
      });

    // Человеку называют файл и причину — иначе непонятно, почему из двух
    // дошёл один.
    expect(decodeURIComponent(resposta.headers.location ?? "")).toContain("falso.png");

    const depois = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(depois.text).toContain("nota.pdf");
    expect(depois.text).not.toContain("falso.png");
  });
});
