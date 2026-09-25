import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Дело, заведённое до входа, достаётся тому, кто вошёл.
 *
 * Человек рассказывает о проблеме гостем, видит разбор и только потом
 * называет телефон. Между этими двумя моментами дело живёт в подписанной
 * куке. Если привязка не сработает, он войдёт в пустую учётную запись, а его
 * дело останется ничьим — с документами и разбором, за который уже
 * заплачено. Заметить это некому: обе половины по отдельности работают.
 *
 * Отдельно проверяется, что дело не задваивается и номер не меняется: по
 * номеру человек находит своё дело и называет его в разговоре с компанией.
 */

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

const RELATO =
  "Comprei um produto pela internet, o prazo de entrega terminou e até agora não recebi o pedido.";

/** Гость описывает проблему. Возвращает его куки и номер дела. */
async function contarComoConvidado(): Promise<{ cookies: string[]; publicId: string }> {
  const home = await openPage(harness.app, "/", []);
  const criado = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: RELATO });

  const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(criado.headers.location ?? "")?.[1];
  if (!publicId) throw new Error(`дело не создано: ${criado.headers.location}`);

  const cookies = [
    ...home.cookies,
    ...((criado.headers["set-cookie"] as unknown as string[]) ?? []),
  ];
  return { cookies, publicId };
}

describe("дело гостя после входа (§15)", () => {
  it("достаётся вошедшему и видно в «Meus casos»", async () => {
    const { cookies, publicId } = await contarComoConvidado();

    // Дело ещё ничьё.
    expect((await harness.cases.findByPublicId(publicId))?.userId).toBeNull();

    const entrou = await login(harness, "11987654321", { cookies });

    const guardado = await harness.cases.findByPublicId(publicId);
    expect(guardado?.userId).not.toBeNull();
    // Номер не меняется: по нему человек находит дело и называет его компании.
    expect(guardado?.publicId).toBe(publicId);

    const conta = await request(harness.app)
      .get("/minha-conta")
      .set("Cookie", entrou);
    expect(conta.status).toBe(200);
    expect(conta.text).toContain(publicId);
  });

  it("дело не задваивается", async () => {
    const { cookies, publicId } = await contarComoConvidado();
    await login(harness, "11987654321", { cookies });

    const dono = (await harness.cases.findByPublicId(publicId))!.userId!;
    const todos = await harness.cases.listForUser(dono);

    expect(todos).toHaveLength(1);
    expect(todos[0]?.publicId).toBe(publicId);
  });

  it("страница дела открывается уже как своя, а не по куке гостя", async () => {
    const { cookies, publicId } = await contarComoConvidado();
    const entrou = await login(harness, "11987654321", { cookies });

    // Куку с номером дела вход гасит — доступ теперь по владельцу.
    const pagina = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", entrou.filter((c) => !c.startsWith("rb_caso=")));

    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain(RELATO);
  });

  it("чужой номер дела в куке не достаётся вошедшему", async () => {
    // Подделать куку нельзя — она подписана, — но если бы удалось, дело
    // всё равно не должно уйти чужому.
    const alheio = await contarComoConvidado();
    const outro = await contarComoConvidado();

    await login(harness, "11987654321", { cookies: alheio.cookies });
    const segundo = await login(harness, "21987654321", { cookies: outro.cookies });

    const conta = await request(harness.app)
      .get("/minha-conta")
      .set("Cookie", segundo);

    expect(conta.text).toContain(outro.publicId);
    expect(conta.text).not.toContain(alheio.publicId);
  });
});
