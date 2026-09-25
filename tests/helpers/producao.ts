import { resetConfigCache } from "../../src/config/env";
import { createMemoryStores } from "../../src/users/memoryStoreSet";
import { resetOtpProviderCache } from "../../src/users/otpProvider";
import { setStores } from "../../src/users/storeRegistry";

/**
 * Окружение боевого стенда для тестов.
 *
 * Собрано в одном месте не ради краткости: список обязательного в production
 * растёт (§79), и разложенный по файлам он расходится. Когда появляется новое
 * требование, тесты, забывшие о нём, падают все сразу и на непонятном месте —
 * «конфигурация production» вместо проверяемого свойства.
 *
 * Значения поддельные, но по форме настоящие: ключей и токенов здесь нет и
 * быть не может — они живут только в переменных окружения стенда (§76).
 */
export const CHAVE_FALSA = "chave-de-teste-nao-real";

export function ambienteDeProducao(extra: Record<string, string> = {}): void {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgresql://u:p@localhost:6543/postgres";
  process.env.SESSION_SECRET = "x".repeat(40);
  process.env.APP_URL = "https://exemplo.test";

  // Заглушка модели в production больше не считается настройкой: она
  // возвращает пустой разбор, и человек получает его вместо ответа.
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = CHAVE_FALSA;
  process.env.OPENAI_MODEL = "modelo-de-teste";

  // То же и про канал кода: на mock код не уходит никуда, и войти нельзя
  // вообще. Поэтому боевое окружение всегда с настоящим каналом.
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_API_KEY = "token-de-teste";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_API_VERSION = "v21.0";
  process.env.WHATSAPP_TEMPLATE = "codigo_de_acesso";

  Object.assign(process.env, extra);

  resetConfigCache();
  resetOtpProviderCache();
  setStores(createMemoryStores());
}
