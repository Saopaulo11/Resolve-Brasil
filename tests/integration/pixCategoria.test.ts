import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Категория «Problema com Pix» (§5, §11, §36).
 *
 * Разбор ситуации по Pix в приложении был и раньше, но добраться до него
 * можно было только после того, как способ оплаты извлекут из документов.
 * Человек с бедой ровно про Pix говорил об этом на входе — и его не слышали.
 */

let harness: Harness;

const RELATO =
  "Fiz um Pix de 450 reais para uma loja no Instagram e depois o perfil sumiu.";

beforeEach(() => {
  harness = createHarness();
});

async function criarCaso(
  categoria?: string,
): Promise<{ publicId: string; cookies: string[] }> {
  const cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const criado = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: RELATO, categoria });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(criado.headers.location ?? "")?.[1];
  if (!publicId) throw new Error("дело не создано");
  // Куки возвращаем те же: повторный вход завёл бы новую сессию, страница
  // ответила бы перенаправлением, и проверка прошла бы впустую.
  return { publicId, cookies: home.cookies };
}

describe("категория «Problema com Pix»", () => {
  it("предлагается на главной", async () => {
    const pagina = await request(harness.app).get("/");

    expect(pagina.status).toBe(200);
    // Под полем ввода — короткая подпись: восемь длинных фраз в ряд
    // занимают три строки и спорят с полем за внимание.
    expect(pagina.text).toContain("Problema com Pix");
    expect(pagina.text).toContain("categoria-problema-com-pix");
  });

  it("есть на странице категорий и ведёт на форму", async () => {
    const lista = await request(harness.app).get("/categorias");
    expect(lista.text).toContain("Problema com Pix");

    const atalho = await request(harness.app).get("/categorias/problema-com-pix");
    expect([301, 302, 303]).toContain(atalho.status);
    expect(atalho.headers.location).toContain("categoria=problema-com-pix");
  });

  it("сразу спрашивает, что именно случилось с Pix", async () => {
    // Раньше этот вопрос появлялся только после извлечения фактов из
    // документов — то есть после разбора и вложений.
    const { publicId, cookies } = await criarCaso("problema-com-pix");

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain("Foi um golpe");
    expect(pagina.text).toContain("Não fui eu que fiz esse Pix");
  });

  it("без этой категории вопрос про Pix не навязывается", async () => {
    // Способ оплаты ещё не известен — спрашивать про Pix не о чем.
    const { publicId, cookies } = await criarCaso("produto-nao-recebido");

    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    // Страница должна открыться — иначе проверка ниже пройдёт впустую.
    expect(pagina.status).toBe(200);
    expect(pagina.text).not.toContain("Foi um golpe");
  });

  it("выбор категории сам по себе означает оплату через Pix", async () => {
    const { publicId } = await criarCaso("problema-com-pix");
    const caso = await harness.cases.findByPublicId(publicId);

    expect(caso?.category).toBe("PROBLEMA_COM_PIX");
    expect(caso?.paymentMethod).toBe("PIX");
  });
});
