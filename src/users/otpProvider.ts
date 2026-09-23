import { loadConfig } from "../config/env";
import { logger, maskPhone } from "../utils/logger";

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
 * Код пишется в лог, иначе локально невозможно войти. В production этот
 * провайдер недоступен: loadConfig() требует настоящий OTP_PROVIDER, а
 * печатать код в лог там было бы прямой утечкой второго фактора (§76).
 */
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock";

  async send(phone: string, code: string): Promise<{ delivered: boolean }> {
    const config = loadConfig();

    if (config.isProduction) {
      throw new Error("MockOtpProvider недопустим в production. Задайте OTP_PROVIDER.");
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

  throw new Error(
    `OTP_PROVIDER=${config.otp.provider}: провайдер не реализован (PHASE 2). ` +
      "Оставьте OTP_PROVIDER пустым для режима mock.",
  );
}

export function resetOtpProviderCache(): void {
  instance = null;
}
