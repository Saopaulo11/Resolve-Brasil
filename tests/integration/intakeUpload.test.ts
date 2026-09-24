import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, mergeCookies, type Harness } from "../helpers/auth";
import { PDF_BYTES, PNG_BYTES } from "../helpers/files";

/**
 * Вложения, приложенные вместе с рассказом (§6).
 *
 * Чек и переписка есть у человека в тот момент, когда он описывает проблему.
 * Если попросить его приложить их шагом позже, на отдельной странице, часть
 * так и не вернётся — и дело останется без доказательств.
 */
const RELATO =
  "Comprei uma geladeira, paguei no Pix em 10/09/2026 e até hoje não recebi.";

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

async function enviarComArquivos(
  cookies: string[],
  arquivos: Array<[Buffer, string, string]>,
) {
  const home = await openPage(harness.app, "/", cookies);
  let req = request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .field("_csrf", home.token)
    .field("description", RELATO);

  for (const [bytes, filename, contentType] of arquivos) {
    req = req.attach("arquivo", bytes, { filename, contentType });
  }

  const response = await req;
  return {
    response,
    // До входа адрес приходит как /entrar?next=%2Fcaso%2FRB-XXXXXX.
    publicId: /caso[/%2F]+(RB-[A-Z2-9]{6})/i.exec(
      decodeURIComponent(`${response.headers.location ?? ""}`),
    )?.[1],
    cookies: mergeCookies(
      home.cookies,
      (response.headers["set-cookie"] as unknown as string[]) ?? [],
    ),
  };
}

describe("вошедший пользователь", () => {
  it("прикладывает несколько файлов вместе с рассказом", async () => {
    const sessao = await login(harness, "11987654321");
    const { response, publicId } = await enviarComArquivos(sessao, [
      [PDF_BYTES, "nota.pdf", "application/pdf"],
      [PNG_BYTES, "comprovante.png", "image/png"],
    ]);

    expect(response.status).toBe(303);
    expect(publicId).toMatch(/^RB-[A-Z2-9]{6}$/);

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", sessao);

    expect(pagina.text).toContain("nota.pdf");
    expect(pagina.text).toContain("comprovante.png");
  });

  it("отсекает повтор того же файла внутри одной отправки", async () => {
    // На телефоне один и тот же снимок выбирается дважды без труда.
    const sessao = await login(harness, "11987654321");
    const { publicId } = await enviarComArquivos(sessao, [
      [PDF_BYTES, "nota.pdf", "application/pdf"],
      [PDF_BYTES, "nota-copia.pdf", "application/pdf"],
    ]);

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", sessao);

    expect(pagina.text).toContain("nota.pdf");
    expect(pagina.text).not.toContain("nota-copia.pdf");
  });

  it("не теряет дело, если файл не принят", async () => {
    const sessao = await login(harness, "11987654321");
    const { response, publicId } = await enviarComArquivos(sessao, [
      [Buffer.from("isto nao e um pdf"), "falso.pdf", "application/pdf"],
    ]);

    // Рассказ важнее вложения: дело создано, про файл сказано отдельно.
    expect(response.status).toBe(303);
    expect(publicId).toMatch(/^RB-[A-Z2-9]{6}$/);
    expect(response.headers.location).toContain("aviso=");
  });
});

describe("до входа", () => {
  it("вложение остаётся у дела и обретает владельца после входа", async () => {
    const { response, publicId, cookies } = await enviarComArquivos([], [
      [PDF_BYTES, "comprovante.pdf", "application/pdf"],
    ]);

    expect(response.status).toBe(303);
    expect(response.headers.location).toContain("/caso/");

    const documentos = await harness.documents.listForCase(
      (await harness.cases.findByPublicId(publicId ?? ""))?.id ?? "",
    );
    expect(documentos).toHaveLength(1);
    expect(documentos[0]?.userId).toBeNull();

    // После подтверждения телефона дело и вложение становятся его.
    const sessao = await login(harness, "11987654321", { cookies });
    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", sessao);

    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain("comprovante.pdf");

    const depois = await harness.documents.listForCase(
      (await harness.cases.findByPublicId(publicId ?? ""))?.id ?? "",
    );
    expect(depois[0]?.userId).not.toBeNull();
  });
});
