import { loadConfig } from "../config/env";
import { logger, maskPhone } from "../utils/logger";

// Обратная ссылка в whatsappOtpProvider — только на тип, она стирается при
// сборке, поэтому кольца модулей во время выполнения не возникает.
import { WhatsappOtpProvider } from "./whatsappOtpProvider";

/**
 * Доставка одноразовых кодов (§15, §79).
 */
export interface OtpProvider {
  readonly name: string;
  send(phone: string, code: string): Promise<{ delivered: boolean; error?: string }>;
}

/**
 * MOCK / DEVELOPMENT ONLY (§79).
 *
 * Код пишется в лог, иначе локально невозможно войти. В production код в лог
 * не попадает никогда — это была бы прямая утечка второго фактора (§76), —
 * и отправки не происходит.
 *
 * Отказ здесь возвращается, а не бросается. Прежде исключение поднималось до
 * обработчика, и человек с верным номером получал «Algo deu errado»: страницу
 * без объяснения, из которой не следует ни что случилось, ни что делать.
 * Настоящая причина — ненастроенный канал — видна в логе и в /health, то есть
 * тому, кто может её исправить.
 */
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock";

  async send(phone: string, code: string): Promise<{ delivered: boolean; error?: string }> {
    const config = loadConfig();

    if (config.isProduction) {
      logger().error(
        { phone: maskPhone(phone) },
        "OTP_PROVIDER не задан: код не отправлен. Войти невозможно, пока канал не настроен.",
      );
      return { delivered: false, error: "provedor_nao_configurado" };
    }

    logger().warn(
      { phone: maskPhone(phone), mock: true },
      `MOCK OTP para ${maskPhone(phone)}: ${code}`,
    );
    return { delivered: true };
  }
}

let instance: OtpProvider | null = null;

export function otpProvider(): OtpProvider {
  if (instance) return instance;

  const config = loadConfig();
  if (config.otp.provider === "mock") {
    instance = new MockOtpProvider();
    return instance;
  }

  if (config.otp.provider === "whatsapp") {
    instance = new WhatsappOtpProvider();
    return instance;
  }

  throw new Error(
    `OTP_PROVIDER=${config.otp.provider}: провайдер не реализован. ` +
      "Доступны whatsapp и mock (mock — только вне production).",
  );
}

/** Для тестов: подставить провайдер, перехватывающий код. */
export function setOtpProvider(custom: OtpProvider): void {
  instance = custom;
}

export function resetOtpProviderCache(): void {
  instance = null;
}
