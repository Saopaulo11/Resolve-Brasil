import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { ELF_BYTES, HTML_BYTES, PDF_BYTES } from "../helpers/files";

let harness: Harness;

async function createCase(cookies: string[]): Promise<string> {
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({
      _csrf: home.token,
      description: "Paguei por um servico que nunca foi realizado, faz duas semanas.",
    });
  return /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

async function upload(
  cookies: string[],
  publicId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/documentos`)
    .set("Cookie", page.cookies)
    .field("_csrf", page.token)
    .field("tipo", "OUTRO")
    .attach("arquivo", bytes, { filename, contentType });
}

beforeEach(() => {
  resetConfigCache();
  resetAiProviderCache();
  harness = createHarness();
});

afterEach(() => {
  setOpenAiClient(null);
  resetConfigCache();
  resetAiProviderCache();
});

describe("подмена типа файла (§25)", () => {
  it("отвергает исполняемый файл с именем .pdf", async () => {
    // Классика: переименовать бинарник и подставить Content-Type.
    const alice = await login(harness, "11987654321");
    const publicId = await createCase(alice);

    const response = await upload(
      alice,
      publicId,
      ELF_BYTES,
      "comprovante.pdf",
      "application/pdf",
    );

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não corresponde ao tipo declarado",
    );

    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(await harness.documents.listForCase(caseRecord!.id)).toHaveLength(0);
  });

  it("отвергает HTML со скриптом под видом картинки", async () => {
    const alice = await login(harness, "11987654321");
    const publicId = await createCase(alice);

    const response = await upload(alice, publicId, HTML_BYTES, "print.png", "image/png");

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não corresponde",
    );
  });

  it("отвергает неразрешённое расширение при верном содержимом", async () => {
    const alice = await login(harness, "11987654321");
    const publicId = await createCase(alice);

    const response = await upload(
      alice,
      publicId,
      PDF_BYTES,
      "comprovante.exe",
      "application/pdf",
    );

    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "não corresponde",
    );
  });

  it("отвергает файл сверх лимита размера", async () => {
    const alice = await login(harness, "11987654321");
    const publicId = await createCase(alice);

    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(11 * 1024 * 1024, 0x20)]);
    const response = await upload(alice, publicId, big, "grande.pdf", "application/pdf");

    // Не 500 и не страница ошибки: слишком большой файл — обычный отказ.
    // Страницей ошибки это быть перестало намеренно: она уносила с собой
    // рассказ, набранный на той же форме (см. uploadLimits.test.ts).
    expect(response.status).toBe(303);
    expect(decodeURIComponent(response.headers.location ?? "")).toContain("grande.pdf");

    // Главное: в деле его нет.
    const caso = await harness.cases.findByPublicId(publicId);
    expect(await harness.documents.listForCase(caso?.id ?? "")).toHaveLength(0);
  });

  it("файл заведомо неподъёмного размера обрывается разбором", async () => {
    // Потолок разбора выше предела, но не бесконечен: иначе одна форма
    // способна занять всю память процесса.
    const alice = await login(harness, "11987654321");
    const publicId = await createCase(alice);

    const enorme = Buffer.concat([PDF_BYTES, Buffer.alloc(13 * 1024 * 1024, 0x20)]);
    const response = await upload(alice, publicId, enorme, "enorme.pdf", "application/pdf");

    expect(response.status).toBe(413);
    expect(response.text).toContain("Arquivo não aceito");
  });
});

describe("доступ к чужим документам (§80)", () => {
  let publicId: string;
  let documentId: string;
  let alice: string[];

  beforeEach(async () => {
    alice = await login(harness, "11987654321");
    publicId = await createCase(alice);
    await upload(alice, publicId, PDF_BYTES, "comprovante.pdf", "application/pdf");

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const documents = await harness.documents.listForCase(caseRecord!.id);
    documentId = documents[0]!.id;
  });

  it("чужой не скачает документ", async () => {
    const bob = await login(harness, "21987654321");
    const response = await request(harness.app)
      .get(`/caso/${publicId}/documentos/${documentId}`)
      .set("Cookie", bob);

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).not.toContain("application/pdf");
  });

  it("чужой не скачает документ и через свой номер дела", async () => {
    // Подстановка своего дела в адрес не должна давать чужой файл.
    const bob = await login(harness, "21987654321");
    const bobCase = await createCase(bob);

    const response = await request(harness.app)
      .get(`/caso/${bobCase}/documentos/${documentId}`)
      .set("Cookie", bob);

    expect(response.status).toBe(404);
  });

  it("без входа документ не отдаётся", async () => {
    const response = await request(harness.app).get(
      `/caso/${publicId}/documentos/${documentId}`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/entrar");
  });

  it("неудачная попытка не пишется как успешное обращение", async () => {
    const bob = await login(harness, "21987654321");
    harness.audit.entries.length = 0;

    await request(harness.app)
      .get(`/caso/${publicId}/documentos/${documentId}`)
      .set("Cookie", bob);

    // В журнале обращений не должно быть записи о чтении чужого файла.
    expect(harness.audit.entries.filter((e) => e.action === "document.read")).toHaveLength(
      0,
    );
  });

  it("чужой не запустит чтение документа", async () => {
    const bob = await login(harness, "21987654321");
    const own = await openPage(harness.app, "/minha-conta", bob);

    const response = await request(harness.app)
      .post(`/caso/${publicId}/documentos/${documentId}/extrair`)
      .set("Cookie", own.cookies)
      .type("form")
      .send({ _csrf: own.token });

    expect(response.status).toBe(404);
  });

  it("чужой не загрузит документ в это дело", async () => {
    const bob = await login(harness, "21987654321");
    const own = await openPage(harness.app, "/minha-conta", bob);

    const response = await request(harness.app)
      .post(`/caso/${publicId}/documentos`)
      .set("Cookie", own.cookies)
      .field("_csrf", own.token)
      .field("tipo", "OUTRO")
      .attach("arquivo", PDF_BYTES, {
        filename: "meu.pdf",
        contentType: "application/pdf",
      });

    expect(response.status).toBe(404);

    const caseRecord = await harness.cases.findByPublicId(publicId);
    expect(await harness.documents.listForCase(caseRecord!.id)).toHaveLength(1);
  });
});

describe("подтверждение чужих фактов", () => {
  it("факт другого дела не редактируется", async () => {
    const alice = await login(harness, "11987654321");
    const alicePublicId = await createCase(alice);
    const aliceCase = await harness.cases.findByPublicId(alicePublicId);

    const [fact] = await harness.facts.createMany([
      {
        caseId: aliceCase!.id,
        documentId: null,
        field: "company",
        value: "Loja da Alice",
        source: "AI_SUGGESTION",
        confidence: 0.9,
      },
    ]);

    const bob = await login(harness, "21987654321");
    const bobPublicId = await createCase(bob);
    const page = await openPage(harness.app, `/caso/${bobPublicId}`, bob);

    // Боб подставляет свой номер дела и чужой идентификатор факта.
    const response = await request(harness.app)
      .post(`/caso/${bobPublicId}/fatos/${fact!.id}`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token, decisao: "corrigir", valor: "Loja do Bob" });

    expect(response.status).toBe(404);

    const unchanged = await harness.facts.findById(fact!.id);
    expect(unchanged?.value).toBe("Loja da Alice");
    expect(unchanged?.status).toBe("UNCONFIRMED");
  });
});
