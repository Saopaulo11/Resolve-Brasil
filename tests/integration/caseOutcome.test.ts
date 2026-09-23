import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyRetention } from "../../src/privacy/retentionService";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Завершение дела и переход на другой канал (§19, §36, §65).
 *
 * До этого статус RESOLVIDO был описан, но недостижим: дело нельзя было
 * закрыть. Вместе с ним не ставилась дата закрытия — а без неё срок
 * хранения не наступает никогда и медиана времени до решения не считается.
 */
let harness: Harness;
let cookies: string[];
let publicId: string;

const DESCRIPTION = "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.";

async function criarCaso() {
  cookies = await login(harness, "11987654321");
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });

  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

async function postar(caminho: string, body: Record<string, string>) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/${caminho}`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, ...body });
}

beforeEach(async () => {
  process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
  resetConfigCache();
  harness = createHarness();
  await criarCaso();
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  resetConfigCache();
});

describe("завершение дела (§19)", () => {
  it("отмечает решённое и ставит дату закрытия", async () => {
    const response = await postar("encerrar", { desfecho: "resolvido" });
    expect(response.status).toBe(303);

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.status).toBe("RESOLVIDO");
    // Без даты закрытия срок хранения не наступает никогда (§65).
    expect(caso?.closedAt).not.toBeNull();
  });

  it("закрытие без решения не выглядит успехом", async () => {
    await postar("encerrar", { desfecho: "encerrado" });

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.status).toBe("ENCERRADO");
    expect(caso?.closedAt).not.toBeNull();

    // В аналитике это разные исходы, а не один «завершён».
    const [slice] = await harness.analytics.listReal();
    expect(slice?.resolutionStatus).toBe("ENCERRADO");
  });

  it("закрытие попадает в хронологию как слова пользователя", async () => {
    await postar("encerrar", { desfecho: "resolvido" });

    const caso = await harness.cases.findByPublicId(publicId);
    const eventos = await harness.cases.listEvents(caso!.id);
    const encerramento = eventos.find((item) => item.type === "caso_encerrado");

    expect(encerramento?.title).toContain("resolvido");
    // §5: мы не знаем, вернулись ли деньги. Это факт от человека.
    expect(encerramento?.source).toBe("USER_FACT");
  });

  it("повторное закрытие не сдвигает дату", async () => {
    await postar("encerrar", { desfecho: "resolvido" });
    const primeiro = (await harness.cases.findByPublicId(publicId))?.closedAt;

    const repetido = await postar("encerrar", { desfecho: "encerrado" });

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.closedAt).toEqual(primeiro);
    expect(caso?.status).toBe("RESOLVIDO");
    expect(decodeURIComponent(repetido.headers.location ?? "")).toContain("já está encerrado");
  });

  it("время до решения попадает в аналитику", async () => {
    await postar("encerrar", { desfecho: "resolvido" });

    const [slice] = await harness.analytics.listReal();
    expect(slice?.resolutionDays).not.toBeNull();
    expect(slice?.resolutionDays).toBeGreaterThanOrEqual(0);
  });

  it("закрытое дело возвращается в работу", async () => {
    await postar("encerrar", { desfecho: "encerrado" });
    await postar("reabrir", {});

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.status).toBe("PRECISA_DE_ACAO");
    // Дата закрытия снимается: иначе срок хранения удалит дело в работе.
    expect(caso?.closedAt).toBeNull();
  });

  it("страница закрытого дела не предлагает закрыть его снова", async () => {
    await postar("encerrar", { desfecho: "resolvido" });

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);

    expect(page.text).toContain("Reabrir caso");
    expect(page.text).not.toContain("Encerrar sem solução");
  });
});

describe("переход на другой канал (§36)", () => {
  it("записывает канал и меняет статус", async () => {
    await postar("escalar", { canal: "CONSUMIDOR_GOV" });

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.escalationLevel).toBe("CONSUMIDOR_GOV");
    expect(caso?.status).toBe("ESCALADO");
  });

  it("канал в хронологии — это действие человека, а не наше", async () => {
    // §3: жалобу подаёт он сам, мы не представляем его ни перед кем.
    await postar("escalar", { canal: "OUVIDORIA" });

    const caso = await harness.cases.findByPublicId(publicId);
    const eventos = await harness.cases.listEvents(caso!.id);
    const escalada = eventos.find((item) => item.type === "caso_escalado");

    expect(escalada?.source).toBe("USER_FACT");
    expect(escalada?.title).toContain("Ouvidoria");
  });

  it("эскалация доезжает до аналитики", async () => {
    await postar("escalar", { canal: "SAC" });

    const [slice] = await harness.analytics.listReal();
    expect(slice?.escalationLevel).toBe("SAC");
  });

  it("закрытое дело не эскалируется", async () => {
    await postar("encerrar", { desfecho: "resolvido" });
    const response = await postar("escalar", { canal: "SAC" });

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.escalationLevel).toBe("NENHUM");
    expect(decodeURIComponent(response.headers.location ?? "")).toContain("encerrado");
  });

  it("выдуманный канал не принимается", async () => {
    const response = await postar("escalar", { canal: "TRIBUNAL_SUPREMO" });
    expect(response.status).toBe(404);

    const caso = await harness.cases.findByPublicId(publicId);
    expect(caso?.escalationLevel).toBe("NENHUM");
  });
});

describe("срок хранения закрытых дел (§65)", () => {
  it("закрытое дело уходит по сроку, а дело в работе остаётся", async () => {
    // Раньше это не работало вовсе: closedAt никогда не ставился, и
    // фильтр по нему не находил ни одного дела.
    await postar("encerrar", { desfecho: "resolvido" });

    const fechado = await harness.cases.findByPublicId(publicId);
    // Отодвигаем закрытие в прошлое, за пределы срока хранения.
    const antigo = await harness.cases.findById(fechado!.id);
    antigo!.closedAt = new Date(Date.now() - 4000 * 24 * 60 * 60_000);

    const emAndamento = await harness.cases.create({
      userId: fechado!.userId,
      publicId: "RB-ABERTO",
      description: "Outro caso, ainda em andamento.",
      category: null,
    });

    const result = await applyRetention();

    expect(result.casesDeleted).toBeGreaterThan(0);
    expect(await harness.cases.findById(fechado!.id)).toBeNull();
    expect(await harness.cases.findById(emAndamento.id)).not.toBeNull();
  });
});
