import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAiRequestStore } from "../../src/ai/aiRequestStore";
import { PrismaAnalyticsStore } from "../../src/analytics/analyticsStore";
import { PrismaCaseStore } from "../../src/cases/caseStore";
import { PrismaFeedbackStore } from "../../src/cases/feedbackStore";
import {
  PrismaAuditStore,
  PrismaDocumentStore,
  PrismaFactStore,
} from "../../src/documents/documentStore";
import {
  PrismaNotificationStore,
  PrismaReminderStore,
} from "../../src/notifications/reminderStore";
import { PrismaDeletionRequestStore } from "../../src/privacy/privacyStore";
import { PrismaSourceStore } from "../../src/sources/sourceStore";
import {
  PrismaAdminSessionStore,
  PrismaAdminUserStore,
  PrismaLoginAttemptStore,
} from "../../src/admin/adminStore";
import {
  PrismaConsentStore,
  PrismaOtpStore,
  PrismaSessionStore,
  PrismaUserStore,
} from "../../src/users/stores";
import { resetConfigCache } from "../../src/config/env";
import { db, disconnectDb } from "../../src/services/db";

/**
 * Хранилища на Prisma против настоящего PostgreSQL.
 *
 * Остальные тесты гоняют память: она быстрая и не требует базы. Но
 * реализации на Prisma при этом не выполняются ни разу, и расхождение между
 * ними и схемой обнаружилось бы только в production.
 *
 * Без DATABASE_URL набор пропускается — запускать базу ради `npm test` никто
 * не станет, и тест, который для этого нужно поднимать руками, просто
 * закомментируют.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("хранилища на Prisma", () => {
  const users = new PrismaUserStore();
  const otp = new PrismaOtpStore();
  const sessions = new PrismaSessionStore();
  const consents = new PrismaConsentStore();
  const cases = new PrismaCaseStore();
  const documents = new PrismaDocumentStore();
  const facts = new PrismaFactStore();
  const audit = new PrismaAuditStore();
  const sources = new PrismaSourceStore();
  const reminders = new PrismaReminderStore();
  const notifications = new PrismaNotificationStore();
  const analytics = new PrismaAnalyticsStore();
  const admins = new PrismaAdminUserStore();
  const adminSessions = new PrismaAdminSessionStore();
  const loginAttempts = new PrismaLoginAttemptStore();
  const deletionRequests = new PrismaDeletionRequestStore();
  const feedback = new PrismaFeedbackStore();
  const aiRequests = new PrismaAiRequestStore();

  /** Уникальный хвост: прогоны не должны мешать друг другу. */
  const tag = Date.now().toString(36);
  const phone = `+5511${tag.slice(-9).padStart(9, "9")}`;

  beforeAll(() => {
    resetConfigCache();
  });

  afterAll(async () => {
    await disconnectDb();
    resetConfigCache();
  });

  it("пользователь: создание, поиск, согласия", async () => {
    const user = await users.create(phone);
    expect(user.id).toBeTruthy();
    expect(await users.findByPhone(phone)).toMatchObject({ id: user.id });

    await users.markPhoneVerified(user.id);
    await users.setMarketing(user.id, { consent: true, at: new Date() });
    expect((await users.findById(user.id))?.marketingConsent).toBe(true);

    await consents.record({
      userId: user.id,
      type: "MARKETING",
      version: "1.0",
      accepted: true,
      source: "CADASTRO",
      ipPrefix: "203.0.113.0",
    });

    expect(await users.countAll()).toBeGreaterThan(0);
    expect((await users.listRecent(5)).some((item) => item.id === user.id)).toBe(true);
  });

  it("коды и сессии", async () => {
    const challenge = await otp.create({
      phone,
      codeHash: `hash-${tag}`,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 300_000),
      ipPrefix: "203.0.113.0",
    });
    expect(await otp.findLatest(phone)).toMatchObject({ id: challenge.id });

    expect(await otp.recordAttempt(challenge.id)).toBe(1);
    expect(
      await otp.findRecentByCodeHash(phone, `hash-${tag}`, new Date(Date.now() - 60_000)),
    ).toMatchObject({ id: challenge.id });
    await otp.consume(challenge.id, new Date());
    await otp.invalidateActive(phone, new Date());

    const user = await users.findByPhone(phone);
    await sessions.create({
      userId: user!.id,
      tokenHash: `sessao-${tag}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      ipPrefix: "203.0.113.0",
      userAgent: "teste",
    });
    const sessao = await sessions.findByTokenHash(`sessao-${tag}`);
    expect(sessao).not.toBeNull();

    await sessions.touch(sessao!.id, new Date(Date.now() + 1000), new Date());
    await sessions.revokeByTokenHash(`sessao-${tag}`, new Date());

    // Хранилище возвращает отозванную сессию с отметкой — отказ принимает
    // resolveSession. Проверяется именно он: строка в таблице сама по себе
    // никому доступа не даёт.
    const revogada = await sessions.findByTokenHash(`sessao-${tag}`);
    expect(revogada?.revokedAt).not.toBeNull();
  });

  it("дело: события, сообщения, статус", async () => {
    const user = await users.findByPhone(phone);
    const publicId = `RB-${tag.toUpperCase().slice(-6).padStart(6, "A")}`;

    const created = await cases.create({
      userId: user!.id,
      publicId,
      description: "Comprei um produto e ele não chegou no prazo.",
      category: null,
    });

    expect(await cases.findByPublicId(publicId)).toMatchObject({ id: created.id });
    expect(await cases.publicIdExists(publicId)).toBe(true);

    await cases.addEvent({
      caseId: created.id,
      type: "CRIADO",
      title: "Caso registrado",
      description: null,
      eventDate: new Date(),
      source: "USER_FACT",
    });
    expect(await cases.listEvents(created.id)).toHaveLength(1);

    const request = await aiRequests.create({
      provider: "OPENAI",
      model: "modelo-de-teste",
      operation: "classifyCase",
      promptVersion: "v1",
      inputTokens: 100,
      outputTokens: 40,
      estimatedCost: 0.000123,
      latencyMs: 700,
      success: true,
      errorCode: null,
    });
    // Decimal из PostgreSQL обязан вернуться числом, а не объектом Prisma.
    expect(typeof request.estimatedCost).toBe("number");
    expect(request.estimatedCost).toBeCloseTo(0.000123, 6);

    const message = await cases.addMessage({
      caseId: created.id,
      userId: user!.id,
      direction: "ASSISTANT",
      type: "CLASSIFICACAO",
      content: "Classificação",
      metadata: { category: "PRODUTO_NAO_RECEBIDO", confidence: 0.9 },
      aiRequestId: request.id,
    });

    const [saved] = await cases.listMessages(created.id);
    // Json-поле обязано вернуться объектом, а не строкой.
    expect(saved?.metadata).toMatchObject({ category: "PRODUTO_NAO_RECEBIDO" });

    await cases.setStatus(created.id, "EM_ANALISE");
    await cases.setClassification(created.id, "PRODUTO_NAO_RECEBIDO", "atraso", 0.9);
    expect((await cases.findById(created.id))?.category).toBe("PRODUTO_NAO_RECEBIDO");

    await feedback.create({
      userId: user!.id,
      caseId: created.id,
      messageId: message.id,
      rating: "NAO",
      reason: "INFORMACAO_INCORRETA",
      comment: "A categoria não corresponde",
    });
    expect(await feedback.findForMessage(message.id, user!.id)).not.toBeNull();
    expect((await feedback.countByRating()).nao).toBeGreaterThan(0);
  });

  it("документы и факты", async () => {
    const user = await users.findByPhone(phone);
    const [caso] = await cases.listForUser(user!.id);

    const document = await documents.create({
      caseId: caso!.id,
      userId: user!.id,
      filename: "recibo.pdf",
      mimeType: "application/pdf",
      fileSize: 2048,
      storageKey: `casos/${caso!.publicId}/${tag}`,
      kind: "NOTA_FISCAL",
      checksumSha256: "a".repeat(64),
      scanStatus: "nao_verificado",
    });

    expect(await documents.listForCase(caso!.id)).toHaveLength(1);
    await documents.setExtractionStatus(document.id, "CONCLUIDA", null);
    expect((await documents.findById(document.id))?.extractionStatus).toBe("CONCLUIDA");

    const [fact] = await facts.createMany([
      {
        caseId: caso!.id,
        documentId: document.id,
        field: "order_number",
        value: "55512345",
        source: "AI_SUGGESTION",
        confidence: 0.8,
      },
    ]);
    await facts.updateStatus(fact!.id, "CONFIRMED", "55512345", new Date());
    expect((await facts.findById(fact!.id))?.status).toBe("CONFIRMED");

    expect(await documents.listRecent(5)).not.toHaveLength(0);
  });

  it("источники: подтверждение и отказ", async () => {
    const url = `https://www.gov.br/exemplo-${tag}`;
    const source = await sources.upsert({
      organization: "Governo Federal",
      title: "Página de exemplo",
      url,
      category: null,
    });

    // Непроверенный источник не должен попадать в выборку для дела (§32).
    expect(await sources.listUsable(new Date(Date.now() - 86_400_000), 10)).not.toContainEqual(
      expect.objectContaining({ id: source.id }),
    );

    await sources.markVerified(source.id, new Date());
    expect(
      (await sources.listUsable(new Date(Date.now() - 86_400_000), 10)).some(
        (item) => item.id === source.id,
      ),
    ).toBe(true);

    await sources.markUnavailable(source.id, "404");
    expect((await sources.findByUrl(url))?.active).toBe(false);
  });

  it("напоминания и уведомления", async () => {
    const user = await users.findByPhone(phone);
    const [caso] = await cases.listForUser(user!.id);

    const reminder = await reminders.create({
      userId: user!.id,
      caseId: caso!.id,
      type: "VERIFICAR_RESPOSTA",
      title: "Verificar a resposta da empresa",
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const due = await reminders.listDue(new Date(), new Date(), 10);
    expect(due.some((item) => item.id === reminder.id)).toBe(true);

    expect(await reminders.markAttemptFailed(reminder.id, new Date())).toBe(1);
    await reminders.markSent(reminder.id, new Date());
    expect((await reminders.findById(reminder.id))?.status).toBe("ENVIADO");

    await notifications.record({
      userId: user!.id,
      channel: "SMS",
      purpose: "SERVICO",
      template: "lembrete",
      payload: { caso: caso!.publicId },
      status: "ENVIADA",
      error: null,
    });

    const recent = await notifications.listRecent(5);
    expect(recent).not.toHaveLength(0);
    // payload не выбирается: админке он не нужен (§51).
    expect(recent[0]).not.toHaveProperty("payload");
  });

  it("админ: вход, сессия, журнал", async () => {
    const email = `admin-${tag}@exemplo.com`;
    const admin = await admins.create({
      email,
      passwordHash: `scrypt$fake$${tag}`,
      role: "OWNER",
    });

    expect(await admins.findByEmail(email)).toMatchObject({ id: admin.id });
    await admins.markLogin(admin.id, new Date());

    await loginAttempts.record({ email, ipPrefix: "203.0.113.0", success: false });
    expect(await loginAttempts.countFailuresSince(email, new Date(Date.now() - 60_000))).toBe(1);

    await adminSessions.create({
      adminUserId: admin.id,
      tokenHash: `admin-${tag}`,
      ipPrefix: "203.0.113.0",
      userAgent: "teste",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(await adminSessions.findByTokenHash(`admin-${tag}`)).not.toBeNull();

    await audit.record({
      adminUserId: admin.id,
      action: "admin.access",
      entityType: "permission",
      entityId: "users.list",
      metadata: { rota: "/admin/usuarios" },
      ipPrefix: "203.0.113.0",
    });
    expect((await audit.list(5)).some((entry) => entry.entityId === "users.list")).toBe(true);
  });

  it("аналитика: слепок без связи с делом", async () => {
    await analytics.upsert({
      caseKey: `chave-${tag}`,
      month: "2026-09",
      state: null,
      cityBucket: null,
      category: "PRODUTO_NAO_RECEBIDO",
      subcategory: null,
      industry: "OTHER",
      companyNormalized: null,
      amountBucket: "100-500",
      paymentMethod: "PIX",
      resolutionStatus: "EM_ANALISE",
      resolutionDays: null,
      escalationLevel: "NENHUM",
      confidence: 0.9,
      isDemo: false,
    });

    // Повторный upsert не плодит дублей: ключ дела уникален.
    await analytics.upsert({
      caseKey: `chave-${tag}`,
      month: "2026-09",
      state: null,
      cityBucket: null,
      category: "PRODUTO_NAO_RECEBIDO",
      subcategory: null,
      industry: "OTHER",
      companyNormalized: null,
      amountBucket: "100-500",
      paymentMethod: "PIX",
      resolutionStatus: "RESOLVIDO",
      resolutionDays: 12,
      escalationLevel: "NENHUM",
      confidence: 0.9,
      isDemo: false,
    });

    const rows = (await analytics.listReal()).filter((row) => row.caseKey === `chave-${tag}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resolutionStatus).toBe("RESOLVIDO");

    const columns = Object.keys(rows[0] ?? {});
    for (const forbidden of ["userId", "caseId", "phone", "email", "cpf", "description"]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("удаление: запрос, отмена, исполнение", async () => {
    const user = await users.findByPhone(phone);

    const pedido = await deletionRequests.create({
      userId: user!.id,
      reason: null,
      executeAfter: new Date(Date.now() - 1000),
      ipPrefix: "203.0.113.0",
    });

    expect(await deletionRequests.findPendingForUser(user!.id)).toMatchObject({ id: pedido.id });
    expect((await deletionRequests.listDue(new Date(), 10)).some((r) => r.id === pedido.id)).toBe(
      true,
    );

    await deletionRequests.cancel(pedido.id, new Date());
    expect(await deletionRequests.findPendingForUser(user!.id)).toBeNull();
  });

  it("удаление пользователя уносит дела и документы, но не слепок", async () => {
    const user = await users.findByPhone(phone);
    const [caso] = await cases.listForUser(user!.id);

    await cases.deleteCase(caso!.id);
    await users.deleteUser(user!.id);

    expect(await users.findByPhone(phone)).toBeNull();
    expect(await cases.findById(caso!.id)).toBeNull();
    expect(await db().document.count({ where: { caseId: caso!.id } })).toBe(0);

    // Слепок остаётся: он ни на кого не указывает, и удалять там нечего (§64).
    const rows = (await analytics.listReal()).filter((row) => row.caseKey === `chave-${tag}`);
    expect(rows).toHaveLength(1);
  });
});
