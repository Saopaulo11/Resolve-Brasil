import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { storageProvider } from "../../src/documents/storage";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";
import { PDF_BYTES, PNG_BYTES } from "../helpers/files";

/**
 * Удаление приложенного документа (§21, §25).
 *
 * Приложить не тот файл легко — с телефона особенно. Без способа убрать его
 * человек либо бросает дело, либо оставляет в нём чужой документ, который
 * потом уедет в извлечение фактов и в запрос к модели.
 */
let harness: Harness;
let cookies: string[];
let publicId: string;

async function criarCasoComArquivos() {
  harness = createHarness();
  cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const criado = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .field("_csrf", home.token)
    .field("description", "Comprei um fone, paguei no Pix e ate hoje nao recebi.")
    .attach("arquivo", PDF_BYTES, { filename: "nota.pdf", contentType: "application/pdf" })
    .attach("arquivo", PNG_BYTES, { filename: "foto.png", contentType: "image/png" });

  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(criado.headers.location ?? "")?.[1] ?? "";
}

async function documentos() {
  const caso = await harness.cases.findByPublicId(publicId);
  return harness.documents.listForCase(caso?.id ?? "");
}

beforeEach(criarCasoComArquivos);

describe("владелец убирает файл", () => {
  it("документ исчезает из дела", async () => {
    const antes = await documentos();
    expect(antes).toHaveLength(2);

    const alvo = antes.find((d) => d.filename === "foto.png");
    const pagina = await openPage(harness.app, `/caso/${publicId}`, cookies);
    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos/${alvo?.id}/remover`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token });

    expect(resposta.status).toBe(303);

    const depois = await documentos();
    expect(depois.map((d) => d.filename)).toEqual(["nota.pdf"]);

    // Запись помечена удалённой, а файл ушёл из хранилища. Иначе он лежал бы
    // там вечно: ни retention, ни запрос на удаление данных его уже не
    // найдут — документ для них удалён.
    await expect(storageProvider().get(alvo?.storageKey ?? "")).rejects.toThrow();

    const vista = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    // Ссылки на файл больше нет. Имя при этом остаётся в хронологии — по ней
    // и видно, что документ был и когда исчез.
    expect(vista.text).not.toContain(`/documentos/${alvo?.id}`);
    expect(vista.text).toContain("nota.pdf");
    expect(vista.text).toContain("Documento removido");
  });

  it("удаление остаётся в хронологии дела", async () => {
    // «Куда делся чек» — обычный вопрос по делу, которое тянется неделями.
    const alvo = (await documentos()).find((d) => d.filename === "foto.png");
    const pagina = await openPage(harness.app, `/caso/${publicId}`, cookies);
    await request(harness.app)
      .post(`/caso/${publicId}/documentos/${alvo?.id}/remover`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token });

    const caso = await harness.cases.findByPublicId(publicId);
    const eventos = await harness.cases.listEvents(caso?.id ?? "");
    expect(eventos.map((e) => e.type)).toContain("documento_removido");
  });
});

describe("чужой файл", () => {
  it("посторонний убрать не может", async () => {
    const alvo = (await documentos()).find((d) => d.filename === "foto.png");

    const outro = await login(harness, "21912345678");
    const pagina = await openPage(harness.app, "/", outro);
    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos/${alvo?.id}/remover`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token });

    // Чужое и несуществующее дело неотличимы — иначе по ответу перебирают
    // чужие номера.
    expect(resposta.status).toBe(404);
    expect(await documentos()).toHaveLength(2);
  });

  it("без входа убрать нельзя", async () => {
    const alvo = (await documentos()).find((d) => d.filename === "foto.png");
    const pagina = await openPage(harness.app, "/");

    const resposta = await request(harness.app)
      .post(`/caso/${publicId}/documentos/${alvo?.id}/remover`)
      .set("Cookie", pagina.cookies)
      .type("form")
      .send({ _csrf: pagina.token });

    expect([302, 303]).toContain(resposta.status);
    expect(resposta.headers.location).toContain("/entrar");
    expect(await documentos()).toHaveLength(2);
  });
});
