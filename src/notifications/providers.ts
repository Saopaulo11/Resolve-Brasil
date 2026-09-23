import { loadConfig } from "../config/env";
import { logger, maskPhone } from "../utils/logger";

/**
 * Абстракция доставки сообщений (§38).
 *
 * Бизнес-логика зовёт sendSMS/sendWhatsApp/sendEmail/sendPush и не знает
 * провайдера. Замена оператора не должна трогать код дел.
 */
export type NotificationResult = {
  delivered: boolean;
  providerMessageId: string | null;
  error?: string;
};

export interface NotificationProvider {
  readonly name: string;
  sendSMS(phone: string, text: string): Promise<NotificationResult>;
  sendWhatsApp(phone: string, text: string): Promise<NotificationResult>;
  sendEmail(email: string, subject: string, text: string): Promise<NotificationResult>;
  sendPush(userId: string, title: string, text: string): Promise<NotificationResult>;
}

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Ничего не отправляет. Возвращает delivered: false — иначе на стенде
 * сообщение считалось бы доставленным, и отсутствие интеграции всплыло бы
 * только в production.
 */
export class MockNotificationProvider implements NotificationProvider {
  readonly name = "mock";

  private record(channel: string, target: string): NotificationResult {
    logger().warn(
      { channel, target: maskPhone(target), mock: true },
      "MOCK: notificação não enviada (nenhum provedor configurado)",
    );
    return {
      delivered: false,
      providerMessageId: null,
      error: "MOCK_PROVIDER_NAO_ENVIA",
    };
  }

  async sendSMS(phone: string): Promise<NotificationResult> {
    return this.record("sms", phone);
  }

  async sendWhatsApp(phone: string): Promise<NotificationResult> {
    return this.record("whatsapp", phone);
  }

  async sendEmail(email: string): Promise<NotificationResult> {
    return this.record("email", email);
  }

  async sendPush(userId: string): Promise<NotificationResult> {
    return this.record("push", userId);
  }
}

let instance: NotificationProvider | null = null;

export function notificationProvider(): NotificationProvider {
  if (instance) return instance;

  const config = loadConfig();
  if (config.whatsapp.provider === "mock" && config.email.provider === "mock") {
    instance = new MockNotificationProvider();
    return instance;
  }

  throw new Error(
    "Провайдер уведомлений не реализован (PHASE 8). " +
      "Оставьте WHATSAPP_PROVIDER/EMAIL_PROVIDER пустыми для режима mock.",
  );
}

export function resetNotificationProviderCache(): void {
  instance = null;
}
