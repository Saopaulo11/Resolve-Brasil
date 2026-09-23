import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchDue } from "../../src/notifications/reminderService";
import {
  resetNotificationProviderCache,
  setNotificationProvider,
  type NotificationProvider,
  type NotificationResult,
} from "../../src/notifications/providers";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, login, openPage, type Harness } from "../helpers/auth";

let harness: Harness;
let cookies: string[];
let publicId: string;
let caseId: string;

/** Провайдер, который действительно «доставляет» и запоминает отправленное. */
class DeliveringProvider implements NotificationProvider {
  readonly name = "delivering";
  readonly sent: Array<{ channel: string; target: string; text: string }> = [];

  private ok(channel: string, target: string, text: string): NotificationResult {
    this.sent.push({ channel, target, text });
    return { delivered: true, providerMessageId: "msg-1" };
  }

  async sendSMS(phone: string, text: string) {
    return this.ok("sms", phone, text);
  }
  async sendWhatsApp(phone: string, text: string) {
    return this.ok("whatsapp", phone, text);
  }
  async sendEmail(email: string, _subject: string, text: string) {
    return this.ok("email", email, text);
  }
  async sendPush(userId: string, _title: string, text: string) {
    return this.ok("push", userId, text);
  }
}

async function setup() {
  resetConfigCache();
  resetNotificationProviderCache();
  harness = createHarness();
  cookies = await login(harness, "11987654321");

  const home = await openPage(harness.app, "/", cookies);
  const created = await request(harness.app)
    .post("/caso/novo")
    .set("Cookie", home.cookies)
    .type("form")
    .send({
      _csrf: home.token,
      description: "Comprei um fone, paguei no Pix em 10/09 e ate hoje nao recebi.",
    });
  publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1] ?? "";
  caseId = (await harness.cases.findByPublicId(publicId))!.id;
}

async function criarLembrete(fields: Record<string, string>) {
  const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
  return request(harness.app)
    .post(`/caso/${publicId}/lembretes`)
    .set("Cookie", page.cookies)
    .type("form")
    .send({ _csrf: page.token, ...fields });
}

beforeEach(setup);

afterEach(() => {
  resetNotificationProviderCache();
  resetConfigCache();
});

describe("создание напоминания (§37)", () => {
  it("готовый срок сохраняется и показывается", async () => {
    const response = await criarLembrete({ prazo: "3d", titulo: "Verificar a resposta" });
    expect(response.status).toBe(303);

    const lembretes = await harness.reminders.listForCase(caseId);
    expect(lembretes).toHaveLength(1);
    expect(lembretes[0]?.title).toBe("Verificar a resposta");
    expect(lembretes[0]?.status).toBe("AGENDADO");

    const page = await request(harness.app)
      .get(`/caso/${publicId}`)
      .set("Cookie", cookies);
    expect(page.text).toContain("Verificar a resposta");
  });

  it("пустой заголовок заменяется понятным по умолчанию", async () => {
    await criarLembrete({ prazo: "7d", titulo: "   " });
    const lembretes = await harness.reminders.listForCase(caseId);
    expect(lembretes[0]?.title).toBe("Verificar a resposta da empresa");
  });

  it("дата в прошлом не принимается", async () => {
    const response = await criarLembrete({ prazo: "custom", data: "2020-01-01" });
    expect(decodeURIComponent(response.headers.location ?? "")).toContain(
      "precisa estar no futuro",
    );
    expect(await harness.reminders.listForCase(caseId)).toHaveLength(0);
  });

  it("отмена переводит напоминание в отменённые", async () => {
    await criarLembrete({ prazo: "3d" });
    const [lembrete] = await harness.reminders.listForCase(caseId);

    const page = await openPage(harness.app, `/caso/${publicId}`, cookies);
    await request(harness.app)
      .post(`/caso/${publicId}/lembretes/${lembrete!.id}/cancelar`)
      .set("Cookie", page.cookies)
      .type("form")
      .send({ _csrf: page.token });

    const after = await harness.reminders.findById(lembrete!.id);
    expect(after?.status).toBe("CANCELADO");
  });

  it("чужое напоминание отменить нельзя", async () => {
    await criarLembrete({ prazo: "3d" });
    const [lembrete] = await harness.reminders.listForCase(caseId);

    const bob = await login(harness, "21987654321");
    const own = await openPage(harness.app, "/minha-conta", bob);

    const response = await request(harness.app)
      .post(`/caso/${publicId}/lembretes/${lembrete!.id}/cancelar`)
      .set("Cookie", own.cookies)
      .type("form")
      .send({ _csrf: own.token });

    expect(response.status).toBe(404);
    expect((await harness.reminders.findById(lembrete!.id))?.status).toBe("AGENDADO");
  });
});

describe("рассылка (§38)", () => {
  async function lembreteVencido(): Promise<string> {
    await criarLembrete({ prazo: "3d" });
    const [lembrete] = await harness.reminders.listForCase(caseId);
    // Отматываем срок назад, чтобы напоминание стало наступившим.
    lembrete!.scheduledAt = new Date(Date.now() - 60_000);
    return lembrete!.id;
  }

  it("наступившее напоминание отправляется и отмечается", async () => {
    const provider = new DeliveringProvider();
    setNotificationProvider(provider);
    const id = await lembreteVencido();

    const result = await dispatchDue();

    expect(result.sent).toBe(1);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]?.text).toContain("Resolve Brasil");
    expect((await harness.reminders.findById(id))?.status).toBe("ENVIADO");
  });

  it("не трогает напоминание, срок которого ещё не наступил", async () => {
    const provider = new DeliveringProvider();
    setNotificationProvider(provider);
    await criarLembrete({ prazo: "30d" });

    const result = await dispatchDue();

    expect(result.sent).toBe(0);
    expect(provider.sent).toHaveLength(0);
  });

  it("уведомление записывается как сервисное, а не рекламное (§17)", async () => {
    // Напоминание о своём деле — услуга. Отказ от новостей его не отменяет.
    setNotificationProvider(new DeliveringProvider());
    await lembreteVencido();

    await dispatchDue();

    const records = await harness.notifications.listForUser(
      (await harness.users.findByPhone("+5511987654321"))!.id,
      10,
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.purpose).toBe("SERVICO");
    expect(records[0]?.status).toBe("ENVIADA");
  });

  it("в журнал уведомлений не попадает ни телефон, ни текст (§76)", async () => {
    setNotificationProvider(new DeliveringProvider());
    await lembreteVencido();
    await dispatchDue();

    const serialized = JSON.stringify(harness.notifications.all);
    expect(serialized).not.toContain("+5511987654321");
    expect(serialized).not.toContain("Verificar a resposta");
  });

  it("неудачная отправка не теряется и не повторяется бесконечно", async () => {
    // Заглушка всегда возвращает отказ: ровно тот случай, ради которого
    // и нужен счётчик попыток.
    resetNotificationProviderCache();
    const id = await lembreteVencido();

    let attemptsBefore = 0;
    for (let i = 0; i < 5; i += 1) {
      const reminder = await harness.reminders.findById(id);
      if (reminder?.status !== "AGENDADO") break;
      // Снимаем паузу между попытками.
      reminder.lastAttemptAt = null;
      attemptsBefore = reminder.attempts;
      await dispatchDue();
    }

    const final = await harness.reminders.findById(id);
    expect(final?.status).toBe("CANCELADO");
    expect(final?.attempts).toBe(3);
    expect(attemptsBefore).toBeLessThan(3);

    // Причина осталась в журнале — отказ не исчез молча.
    expect(harness.notifications.all.some((n) => n.status === "FALHOU")).toBe(true);
  });

  it("молчит, если человек выключил уведомления по делам", async () => {
    const provider = new DeliveringProvider();
    setNotificationProvider(provider);
    const id = await lembreteVencido();

    const user = await harness.users.findByPhone("+5511987654321");
    user!.caseNotifications = false;

    const result = await dispatchDue();

    expect(result.skipped).toBe(1);
    expect(provider.sent).toHaveLength(0);
    expect((await harness.reminders.findById(id))?.status).toBe("CANCELADO");
  });
});
