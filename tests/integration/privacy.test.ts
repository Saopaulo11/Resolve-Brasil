import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { executeDueDeletions } from "../../src/privacy/deletionService";
import { applyRetention } from "../../src/privacy/retentionService";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { PDF_BYTES } from "../helpers/files";

let harness: Harness;
let cookies: string[];
let publicId: string;

const DESCRIPTION = "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.";

async function setup() {
  resetConfigCache();
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
  harness = createHarness();
  cookies = await login(harness, "11987654321");

  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });
  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

async function enviarDocumento() {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  await request(harness.app)
    .post(`/caso/${publicId}/documentos`)
    .set("Cookie", page.cookies)
    .field("_csrf", page.token)
    .field("tipo", "COMPROVANTE_PIX")
    .attach("arquivo", PDF_BYTES, {
      filename: "comprovante.pdf",
      contentType: "application/pdf",
    });
}

async function pedirExclusao(confirmacao = "EXCLUIR") {
  const page = await openPage(harness.app, "/minha-conta/privacidade", cookies);
  return request(harness.app)
    .post("/privacy/request")
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, confirmacao, motivo: "não preciso mais" });
}

beforeEach(setup);

afterEach(() => {
  delete process.env.SESSION_SECRET;
  resetConfigCache();
});

describe("выгрузка своих данных (§64)", () => {
  it("отдаётся файлом и содержит дело", async () => {
    const response = await request(harness.app)
      .get("/minha-conta/dados.json")
      .set("Cookie", cookies);

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("attachment");
    // Файл содержит всё о человеке — в промежуточных кешах ему не место.
    expect(response.headers["cache-control"]).toContain("no-store");

    const data = JSON.parse(response.text);
    expect(data.casos).toHaveLength(1);
    expect(data.casos[0].numero).toBe(publicId);
    expect(data.casos[0].relato).toBe(DESCRIPTION);
  });

  it("показывает телефон целиком — это данные самого человека", async () => {
    // Маскирование, уместное в журналах и админке, здесь было бы издевательством.
    const response = await request(harness.app)
      .get("/minha-conta/dados.json")
      .set("Cookie", cookies);

    expect(JSON.parse(response.text).conta.telefone).toContain("98765-4321");
  });

  it("не содержит данных другого человека", async () => {
    const bob = await login(harness, "21987654321");
    const home = await openPage(harness.app, "/", bob);
    await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token, description: "Caso do Bob que ninguem mais deve ver." });

    const response = await request(harness.app)
      .get("/minha-conta/dados.json")
      .set("Cookie", cookies);

    expect(response.text).not.toContain("Caso do Bob");
    expect(response.text).not.toContain("21987654321");
  });

  it("без входа не отдаётся", async () => {
    const response = await request(harness.app).get("/minha-conta/dados.json");
    expect(response.status).toBe(302);
  });
});

describe("запрос на удаление (§64)", () => {
  it("без подтверждения словом не принимается", async () => {
    // Удаление необратимо: случайное нажатие стоит человеку всего дела.
    const response = await pedirExclusao("sim");

    expect(decodeURIComponent(response.headers.location ?? "")).toContain("escreva EXCLUIR");
    expect(harness.deletionRequests.listAll()).toHaveLength(0);
  });

  it("принимается и показывается с датой исполнения", async () => {
    await pedirExclusao();

    const requests = harness.deletionRequests.listAll();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("PENDENTE");
    // Отсрочка — чтобы захваченная учётная запись не стёрла всё разом.
    expect(requests[0]!.executeAfter.getTime()).toBeGreaterThan(Date.now());

    const page = await request(harness.app)
      .get("/minha-conta/privacidade")
      .set("Cookie", cookies);
    expect(page.text).toContain("Pedido registrado");
  });

  it("второй запрос не создаётся", async () => {
    await pedirExclusao();
    const response = await pedirExclusao();

    expect(decodeURIComponent(response.headers.location ?? "")).toContain("em andamento");
    expect(harness.deletionRequests.listAll()).toHaveLength(1);
  });

  it("до срока запрос отменяется", async () => {
    await pedirExclusao();
    const page = await openPage(harness.app, "/minha-conta/privacidade", cookies);

    await request(harness.app)
      .post("/minha-conta/exclusao/cancelar")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    expect(harness.deletionRequests.listAll()[0]?.status).toBe("CANCELADO");
  });

  it("до наступления срока ничего не удаляется", async () => {
    await pedirExclusao();
    const result = await executeDueDeletions();

    expect(result.executed).toBe(0);
    expect(await harness.users.findByPhone("+5511987654321")).not.toBeNull();
  });
});

describe("исполнение удаления", () => {
  it("стирает дела, документы и учётную запись", async () => {
    await enviarDocumento();
    await pedirExclusao();

    const [pedido] = harness.deletionRequests.listAll();
    pedido!.executeAfter = new Date(Date.now() - 1000);

    const caseRecord = await harness.cases.findByPublicId(publicId);
    const caseId = caseRecord!.id;

    const result = await executeDueDeletions();

    expect(result.executed).toBe(1);
    expect(await harness.users.findByPhone("+5511987654321")).toBeNull();
    expect(await harness.cases.findByPublicId(publicId)).toBeNull();
    expect(await harness.documents.listForCase(caseId)).toHaveLength(0);
    expect(harness.deletionRequests.listAll()[0]?.status).toBe("EXECUTADO");
  });

  it("обезличенный слепок в аналитике остаётся", async () => {
    // В нём нет ничего, что ведёт к человеку, и связи с делом тоже нет.
    await pedirExclusao();
    const [pedido] = harness.deletionRequests.listAll();
    pedido!.executeAfter = new Date(Date.now() - 1000);

    const antes = await harness.analytics.countAll();
    expect(antes).toBeGreaterThan(0);

    await executeDueDeletions();
    expect(await harness.analytics.countAll()).toBe(antes);
  });

  it("не трогает дела другого человека", async () => {
    const bob = await login(harness, "21987654321");
    const home = await openPage(harness.app, "/", bob);
    const bobCase = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token, description: "Caso do Bob que deve continuar existindo." });
    const bobPublicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(bobCase.headers.location ?? "")?.[1];

    await pedirExclusao();
    const [pedido] = harness.deletionRequests.listAll();
    pedido!.executeAfter = new Date(Date.now() - 1000);

    await executeDueDeletions();

    expect(await harness.cases.findByPublicId(bobPublicId!)).not.toBeNull();
    expect(await harness.users.findByPhone("+5521987654321")).not.toBeNull();
  });
});

describe("сроки хранения (§65)", () => {
  it("удаляет документы старше срока", async () => {
    await enviarDocumento();
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const [doc] = await harness.documents.listForCase(caseRecord!.id);

    // Отматываем дату загрузки за пределы срока.
    doc!.createdAt = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

    const result = await applyRetention();

    expect(result.documentsDeleted).toBe(1);
    expect(await harness.documents.listForCase(caseRecord!.id)).toHaveLength(0);
  });

  it("не трогает свежих документов", async () => {
    await enviarDocumento();
    const result = await applyRetention();

    expect(result.documentsDeleted).toBe(0);
  });

  it("открытое дело живёт, сколько нужно человеку", async () => {
    // Срок считается от закрытия: дело в разгаре не исчезает по таймеру.
    const caseRecord = await harness.cases.findByPublicId(publicId);
    caseRecord!.createdAt = new Date(Date.now() - 4000 * 24 * 60 * 60 * 1000);

    const result = await applyRetention();

    expect(result.casesDeleted).toBe(0);
    expect(await harness.cases.findByPublicId(publicId)).not.toBeNull();
  });

  it("удаляет дело, закрытое давно", async () => {
    const caseRecord = await harness.cases.findByPublicId(publicId);
    caseRecord!.closedAt = new Date(Date.now() - 4000 * 24 * 60 * 60 * 1000);

    const result = await applyRetention();

    expect(result.casesDeleted).toBe(1);
    expect(await harness.cases.findByPublicId(publicId)).toBeNull();
  });

  it("чистит журнал доступа старше срока", async () => {
    await harness.audit.record({
      adminUserId: null,
      action: "document.read",
      entityType: "Document",
      entityId: "x",
      metadata: null,
      ipPrefix: null,
    });
    harness.audit.entries[0]!.createdAt = new Date(
      Date.now() - 1000 * 24 * 60 * 60 * 1000,
    );

    const result = await applyRetention();
    expect(result.auditDeleted).toBe(1);
  });
});
