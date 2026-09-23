import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { buildExport } from "../../src/privacy/exportService";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Выход со всех устройств (§66) и полнота выгрузки (§64).
 *
 * Вход у нас по номеру и коду: пароля, который можно сменить, не
 * существует. Без отзыва всех сессий у человека с потерянным телефоном нет
 * вообще никакого способа прекратить чужой доступ — сессия живёт месяц.
 */
let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

/**
 * Второй вход с того же номера упирается в паузу между отправками кода.
 * Отматываем создание предыдущего кода назад — пауза уже прошла.
 */
async function passarACooldown(phone: string) {
  const challenge = await harness.otp.findLatest(phone);
  if (challenge) {
    challenge.createdAt = new Date(challenge.createdAt.getTime() - 10 * 60_000);
  }
}

describe("выход со всех устройств (§66)", () => {
  it("отзывает и другие сессии, и текущую", async () => {
    const celular = await login(harness, "11987654321", { marketing: true });
    await passarACooldown("+5511987654321");
    const computador = await login(harness, "11987654321");

    // Оба устройства вошли.
    expect(
      (await request(harness.app).get("/minha-conta").set("Cookie", celular)).status,
    ).toBe(200);
    expect(
      (await request(harness.app).get("/minha-conta").set("Cookie", computador)).status,
    ).toBe(200);

    const page = await openPage(harness.app, "/minha-conta", computador);
    const response = await request(harness.app)
      .post("/sair-de-todos")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    expect(response.status).toBe(303);

    // «Все» значит все: иначе человек решит, что вышел, а на этом
    // устройстве останется вошедшим.
    for (const cookies of [celular, computador]) {
      const depois = await request(harness.app).get("/minha-conta").set("Cookie", cookies);
      expect(depois.status).toBe(302);
    }
  });

  it("без входа ничего не отзывает", async () => {
    const page = await openPage(harness.app, "/entrar");
    const response = await request(harness.app)
      .post("/sair-de-todos")
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/entrar");
  });

  it("предлагается там, где человек будет его искать", async () => {
    const cookies = await login(harness, "11987654321");
    const page = await request(harness.app).get("/minha-conta").set("Cookie", cookies);

    expect(page.text).toContain("Perdeu o celular?");
    expect(page.text).toContain("Sair de todos os aparelhos");
  });
});

describe("согласия в выгрузке данных (§64)", () => {
  it("выгрузка показывает, с чем и когда человек согласился", async () => {
    // Раздел согласий раньше всегда был пустым: по LGPD это ровно те
    // данные, за которыми человек и приходит.
    await login(harness, "11987654321", { marketing: true });

    const user = await harness.users.findByPhone("+5511987654321");
    const dados = await buildExport(user!.id);

    expect(dados?.consentimentos.length).toBeGreaterThan(0);

    const consentimento = dados!.consentimentos[0]!;
    expect(consentimento).toHaveProperty("tipo");
    expect(consentimento).toHaveProperty("versao");
    expect(consentimento).toHaveProperty("quando");
    expect(typeof consentimento.quando).toBe("string");
  });

  it("выгрузка не выдумывает согласий, которых не было", async () => {
    await login(harness, "11987654321");

    const user = await harness.users.findByPhone("+5511987654321");
    const dados = await buildExport(user!.id);

    const marketing = dados!.consentimentos.filter((item) => item.tipo === "MARKETING");
    // Галочку не ставили — согласия на маркетинг быть не должно ни в каком
    // виде, в том числе «aceito: false» из ниоткуда.
    for (const item of marketing) {
      expect(item.aceito).toBe(false);
    }
  });
});
