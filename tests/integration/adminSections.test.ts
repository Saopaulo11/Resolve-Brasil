import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/admin/password";
import { GRANTED_TO_NOBODY, ROLE_PERMISSIONS } from "../../src/admin/rbac";
import type { AdminRole } from "../../src/generated/prisma/enums";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, openPage, mergeCookies, type Harness } from "../helpers/auth";

/**
 * Разделы админки (§50).
 *
 * Проверяется не то, что страница открывается, а то, чего на ней нет:
 * полного телефона, имени файла, значения ключа. Раздел, который показывает
 * лишнее, однажды покажет его не тому.
 */
let harness: Harness;

const EMAIL = "admin@exemplo.com";
const PASSWORD = "senha-forte-para-teste-2026";

const SECOES = [
  "/admin/usuarios",
  "/admin/documentos",
  "/admin/ia",
  "/admin/fontes",
  "/admin/avaliacoes",
  "/admin/notificacoes",
  "/admin/configuracoes",
] as const;

async function criarAdmin(role: AdminRole = "OWNER") {
  return harness.admins.create({
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
}

async function entrar(): Promise<string[]> {
  const page = await openPage(harness.app, "/admin/entrar");
  const response = await request(harness.app)
    .post("/admin/entrar")
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, email: EMAIL, senha: PASSWORD });

  return mergeCookies(
    page.cookies,
    (response.headers["set-cookie"] as unknown as string[]) ?? [],
  );
}

async function abrir(role: AdminRole, path: string) {
  await criarAdmin(role);
  const cookies = await entrar();
  return request(harness.app).get(path).set("Cookie", cookies);
}

beforeEach(() => {
  resetConfigCache();
  harness = createHarness();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
});

describe("доступ к разделам (§51)", () => {
  it("владелец открывает все разделы", async () => {
    await criarAdmin("OWNER");
    const cookies = await entrar();

    for (const path of SECOES) {
      const response = await request(harness.app).get(path).set("Cookie", cookies);
      expect(response.status, path).toBe(200);
    }
  });

  it("без входа все разделы закрыты", async () => {
    for (const path of SECOES) {
      const response = await request(harness.app).get(path);
      expect(response.status, path).toBe(303);
      expect(response.headers.location).toBe("/admin/entrar");
    }
  });

  it("минимальная роль не открывает ни одного раздела", async () => {
    await criarAdmin("VIEWER");
    const cookies = await entrar();

    for (const path of SECOES) {
      const response = await request(harness.app).get(path).set("Cookie", cookies);
      expect(response.status, path).toBe(403);
    }
  });

  it("поддержка видит документы, но не настройки и не пользователей", async () => {
    await criarAdmin("SUPPORT");
    const cookies = await entrar();

    const permitido = await request(harness.app)
      .get("/admin/documentos")
      .set("Cookie", cookies);
    expect(permitido.status).toBe(200);

    for (const path of ["/admin/configuracoes", "/admin/usuarios", "/admin/ia"]) {
      const negado = await request(harness.app).get(path).set("Cookie", cookies);
      expect(negado.status, path).toBe(403);
    }
  });

  it("аналитик видит расход модели, но не документы", async () => {
    await criarAdmin("ANALYST");
    const cookies = await entrar();

    expect((await request(harness.app).get("/admin/ia").set("Cookie", cookies)).status).toBe(
      200,
    );
    expect(
      (await request(harness.app).get("/admin/documentos").set("Cookie", cookies)).status,
    ).toBe(403);
  });

  it("содержимое документов не выдаётся ни одной роли", async () => {
    // Право есть в матрице, но не выдано никому — и это проверяется, а не
    // держится на памяти того, кто правил файл.
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      for (const forbidden of GRANTED_TO_NOBODY) {
        expect(permissions).not.toContain(forbidden);
      }
    }
  });

  it("каждый вход в чувствительный раздел записывается", async () => {
    await criarAdmin("OWNER");
    const cookies = await entrar();

    await request(harness.app).get("/admin/usuarios").set("Cookie", cookies);
    await request(harness.app).get("/admin/documentos").set("Cookie", cookies);
    await request(harness.app).get("/admin/avaliacoes").set("Cookie", cookies);

    const registrados = harness.audit.entries
      .filter((entry) => entry.action === "admin.access")
      .map((entry) => entry.entityId);

    expect(registrados).toEqual(["users.list", "documents.list", "feedback.view"]);
  });
});

describe("что разделы не показывают (§51, §56)", () => {
  it("телефон в списке пользователей показан не полностью", async () => {
    await harness.users.create("+5511987654321");

    const response = await abrir("OWNER", "/admin/usuarios");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("11987654321");
    expect(response.text).not.toContain("5511987654321");
    expect(response.text).toContain("***4321");
  });

  it("список документов не показывает имени файла", async () => {
    // «cpf-joao.pdf» — уже персональные данные: имя говорит достаточно.
    const user = await harness.users.create("+5511987654321");
    const caso = await harness.cases.create({
      userId: user.id,
      publicId: "RB-AAAAAA",
      description: "Qualquer relato",
    });
    await harness.documents.create({
      caseId: caso.id,
      userId: user.id,
      filename: "cpf-joao-da-silva.pdf",
      mimeType: "application/pdf",
      fileSize: 20480,
      storageKey: "casos/RB-AAAAAA/arquivo",
      kind: "NOTA_FISCAL",
      checksumSha256: null,
      scanStatus: null,
    });

    const response = await abrir("OWNER", "/admin/documentos");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("cpf-joao-da-silva");
    expect(response.text).not.toContain(".pdf");
    // Метаданные при этом на месте — иначе раздел бесполезен.
    expect(response.text).toContain("Nota fiscal");
    expect(response.text).toContain("20 KB");
  });

  it("непроверенный файл не выдаётся за чистый", async () => {
    const user = await harness.users.create("+5511987654321");
    const caso = await harness.cases.create({
      userId: user.id,
      publicId: "RB-BBBBBB",
      description: "Qualquer relato",
    });
    await harness.documents.create({
      caseId: caso.id,
      userId: user.id,
      filename: "recibo.pdf",
      mimeType: "application/pdf",
      fileSize: 2048,
      storageKey: "casos/RB-BBBBBB/arquivo",
      kind: "OUTRO",
      checksumSha256: null,
      scanStatus: null,
    });

    const response = await abrir("OWNER", "/admin/documentos");

    expect(response.text).toContain("não verificado");
    expect(response.text).not.toContain("limpo</td>");
  });

  it("настройки не показывают значения ключа (§41)", async () => {
    process.env.OPENAI_API_KEY = "sk-valor-que-nunca-deve-aparecer-na-tela";
    process.env.OPENAI_MODEL = "modelo-de-teste";
    resetConfigCache();

    const response = await abrir("OWNER", "/admin/configuracoes");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("sk-valor-que-nunca-deve-aparecer-na-tela");
    expect(response.text).not.toContain("sk-");
    // Сам факт наличия ключа показывать нужно: иначе непонятно, почему
    // анализ не работает.
    expect(response.text).toContain("Configurado");
    expect(response.text).toContain("modelo-de-teste");
  });

  it("незаданный ключ показан как незаданный", async () => {
    const response = await abrir("OWNER", "/admin/configuracoes");
    expect(response.text).toContain("Não configurado");
  });
});

describe("раздел фонтов и расхода модели", () => {
  it("пустой список источников не заполняется выдумкой (§30)", async () => {
    const response = await abrir("OWNER", "/admin/fontes");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Nenhuma fonte cadastrada");
    expect(response.text).toContain("npm run sources:verify");
  });

  it("источник без проверки помечен как непроверенный", async () => {
    await harness.sources.upsert({
      organization: "Procon",
      title: "Página de orientação",
      url: "https://exemplo.gov.br/orientacao",
      category: null,
    });

    const response = await abrir("OWNER", "/admin/fontes");

    expect(response.text).toContain("Nunca verificada");
    expect(response.text).not.toContain("Em uso");
  });

  it("без заданных цен стоимость не выдумывается (§45)", async () => {
    await harness.aiRequests.create({
      provider: "OPENAI",
      model: "modelo-de-teste",
      operation: "classifyCase",
      promptVersion: null,
      inputTokens: 1200,
      outputTokens: 300,
      estimatedCost: null,
      latencyMs: 820,
      success: true,
      errorCode: null,
    });

    const response = await abrir("OWNER", "/admin/ia");

    expect(response.status).toBe(200);
    expect(response.text).toContain("preços não configurados");
    expect(response.text).toContain("classifyCase");
    expect(response.text).toContain("1.200");
  });
});

describe("оценки в админке (§52, §57)", () => {
  it("доля «помогло» не показывается на крошечной выборке", async () => {
    const user = await harness.users.create("+5511987654321");
    const caso = await harness.cases.create({
      userId: user.id,
      publicId: "RB-CCCCCC",
      description: "Qualquer relato",
    });
    await harness.feedback.create({
      userId: user.id,
      caseId: caso.id,
      messageId: "mensagem-1",
      rating: "SIM",
      reason: null,
      comment: null,
    });

    const response = await abrir("OWNER", "/admin/avaliacoes");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("100%");
    expect(response.text).toContain("menos de");
  });
});
