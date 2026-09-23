import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { companyProfile, internalReport } from "../../src/analytics/aggregation";
import { DEMO_PHONE, refreshProjection } from "../../src/analytics/pipeline";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

let harness: Harness;
let cookies: string[];

const SECRET = "segredo-de-teste-com-mais-de-32-caracteres";
const DESCRIPTION =
  "Meu telefone e +5511987654321 e meu CPF e 123.456.789-00. Paguei e nao recebi.";

beforeEach(async () => {
  resetConfigCache();
  process.env.SESSION_SECRET = SECRET;
  harness = createHarness();
  cookies = await login(harness, "11987654321");
});

afterEach(() => {
  delete process.env.SESSION_SECRET;
  resetConfigCache();
});

async function criarCaso(): Promise<string> {
  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({ _csrf: home.token, description: DESCRIPTION });
  return /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
}

describe("конвейер Consumer Intelligence (§53, §54)", () => {
  it("слепок появляется вместе с делом", async () => {
    await criarCaso();
    expect(await harness.analytics.countAll()).toBe(1);
  });

  it("в слепок не попадает ничего из рассказа пользователя", async () => {
    // Тот же запрет, что в модульном тесте, но уже на живом пути.
    await criarCaso();

    const serialized = JSON.stringify(harness.analytics.listEverything());
    expect(serialized).not.toContain("+5511987654321");
    expect(serialized).not.toContain("123.456.789-00");
    expect(serialized).not.toContain("nao recebi");
  });

  it("слепок не ссылается на дело и на пользователя", async () => {
    // §55: из аналитики не должно быть пути к операционным таблицам.
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);
    const user = await harness.users.findByPhone("+5511987654321");

    const serialized = JSON.stringify(harness.analytics.listEverything());
    expect(serialized).not.toContain(caseRecord!.id);
    expect(serialized).not.toContain(publicId);
    expect(serialized).not.toContain(user!.id);
  });

  it("изменение дела обновляет слепок, а не плодит строки", async () => {
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);

    await refreshProjection({ ...caseRecord!, status: "RESOLVIDO" });
    await refreshProjection({ ...caseRecord!, status: "ENCERRADO" });

    expect(await harness.analytics.countAll()).toBe(1);
    const rows = harness.analytics.listEverything();
    expect(rows[0]?.resolutionStatus).toBe("ENCERRADO");
  });

  it("демо-дела не попадают в продуктовую аналитику (§82)", async () => {
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);

    // Переводим дело на демо-пользователя.
    const demo = await harness.users.create(DEMO_PHONE);
    await refreshProjection({ ...caseRecord!, userId: demo.id });

    expect(await harness.analytics.countAll()).toBe(1);
    expect(await harness.analytics.listReal()).toHaveLength(0);
  });

  it("без пригодной соли слепок не пишется", async () => {
    // Без секрета псевдоним перебирается по идентификатору, и аналитика
    // перестаёт быть обезличенной — тогда лучше не писать вовсе.
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);

    resetConfigCache();
    process.env.SESSION_SECRET = "curto";

    await refreshProjection({ ...caseRecord!, id: "outro-caso-qualquer" });
    expect(await harness.analytics.countAll()).toBe(1);
  });

  it("сбой аналитики не ломает создание дела", async () => {
    // Аналитика — побочный продукт; её отказ не должен мешать человеку.
    harness.analytics.upsert = async () => {
      throw new Error("хранилище аналитики недоступно");
    };

    const publicId = await criarCaso();
    expect(publicId).toMatch(/^RB-[A-Z2-9]{6}$/);
  });
});

describe("отчёт (§58, §59)", () => {
  it("показывает порог и не раскрывает малых групп", async () => {
    await criarCaso();
    const report = await internalReport();

    expect(report.summary.total).toBe(1);
    expect(report.minGroupSize).toBeGreaterThan(1);
    // Одно дело — это меньше порога, значит ни одной группы не видно.
    expect(report.byCategory.buckets).toHaveLength(0);
    expect(report.byCategory.suppressedCount).toBe(1);
    // Но и доля на такой выборке не считается.
    expect(report.summary.escalationRate).toBeNull();
  });

  it("срез по компании отказывает при малой выборке (§59)", async () => {
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);
    await refreshProjection({ ...caseRecord!, companyNormalized: "loja-exemplo" });

    const profile = await companyProfile("loja-exemplo");

    expect(profile.available).toBe(false);
    expect(profile.sampleSize).toBe(1);
    expect(profile.reason).toContain("Amostra insuficiente");
    expect(profile.byCategory).toBeNull();
  });

  it("срез по компании всегда несёт период и размер выборки", async () => {
    // §59: без них цифры выглядят выводом о компании вообще.
    const publicId = await criarCaso();
    const caseRecord = await harness.cases.findByPublicId(publicId);

    for (let i = 0; i < 30; i += 1) {
      await refreshProjection({
        ...caseRecord!,
        id: `caso-${i}`,
        companyNormalized: "loja-exemplo",
      });
    }

    const profile = await companyProfile("loja-exemplo");

    expect(profile.available).toBe(true);
    expect(profile.sampleSize).toBe(30);
    expect(profile.period?.from).toMatch(/^\d{4}-\d{2}$/);
    expect(profile.period?.to).toMatch(/^\d{4}-\d{2}$/);
  });
});
