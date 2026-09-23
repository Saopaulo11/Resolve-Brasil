import { z } from "zod";

/**
 * Единственное место, где читается process.env (§40, §78).
 *
 * Конфигурация собирается по вызову loadConfig(), а не на уровне модуля:
 * `npm run build` и тесты не должны требовать секретов, иначе CI без них
 * не соберётся. Сервер зовёт loadConfig() при старте и падает сразу, если
 * в production чего-то не хватает — лучше не подняться, чем работать с
 * небезопасным умолчанием.
 */

const nodeEnvSchema = z.enum(["development", "test", "production"]);

/** Провайдеры, которые бизнес-логика различать не обязана (§7, §79). */
const aiProviderSchema = z.enum(["openai", "anthropic", "mock"]);

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function intOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatOrNull(value: string | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(env: NodeJS.ProcessEnv) {
  const nodeEnv = nodeEnvSchema.catch("development").parse(env.NODE_ENV);
  const isProduction = nodeEnv === "production";

  return {
    nodeEnv,
    isProduction,
    port: intOr(env.PORT, 3000),
    appUrl: optionalString(env.APP_URL) ?? "http://localhost:3000",

    // Сколько доверенных прокси стоит перед приложением. На Vercel — один.
    // От этого зависит, какому X-Forwarded-For верить при rate limiting.
    trustedProxyHops: intOr(env.TRUSTED_PROXY_HOPS, 1),

    database: {
      url: optionalString(env.DATABASE_URL),
    },

    session: {
      secret: optionalString(env.SESSION_SECRET),
      cookieName: "rb_session",
      // 30 дней: дело тянется неделями, выкидывать пользователя раньше вредно.
      maxAgeMs: intOr(env.SESSION_MAX_AGE_DAYS, 30) * 24 * 60 * 60 * 1000,
    },

    ai: {
      provider: aiProviderSchema.catch("mock").parse(env.AI_PROVIDER),
      openai: {
        apiKey: optionalString(env.OPENAI_API_KEY),
        // Имя модели не зашивается в код (§40) — только сюда.
        model: optionalString(env.OPENAI_MODEL),
      },
      anthropic: {
        apiKey: optionalString(env.ANTHROPIC_API_KEY),
        model: optionalString(env.ANTHROPIC_MODEL),
      },
      requestTimeoutMs: intOr(env.AI_REQUEST_TIMEOUT_MS, 60_000),
      maxRetries: intOr(env.AI_MAX_RETRIES, 2),
      maxOutputTokens: intOr(env.AI_MAX_OUTPUT_TOKENS, 4096),

      /**
       * Порог, ниже которого классификация не считается подтверждённой
       * (§87). Такая классификация сохраняется как предположение и не
       * меняет категорию дела: неверная категория с виду уверенного
       * ответа уводит дело не туда, и заметить это некому.
       */
      classificationMinConfidence: floatOrNull(env.AI_CLASSIFICATION_MIN_CONFIDENCE) ?? 0.6,

      /**
       * Цены за миллион токенов, в USD. Задаются конфигурацией, а не
       * зашиваются в код: прайс меняется, а неверная цифра в учёте хуже
       * её отсутствия — она выглядит достоверной. Не заданы — стоимость
       * просто не считается (§45).
       */
      pricing: {
        inputPerMillion: floatOrNull(env.OPENAI_PRICE_INPUT_PER_1M),
        outputPerMillion: floatOrNull(env.OPENAI_PRICE_OUTPUT_PER_1M),
      },
    },

    otp: {
      provider: optionalString(env.OTP_PROVIDER) ?? "mock",
      apiKey: optionalString(env.OTP_API_KEY),
      length: intOr(env.OTP_LENGTH, 6),
      // Короткая жизнь и лимит попыток — требование §67.
      ttlSeconds: intOr(env.OTP_TTL_SECONDS, 300),
      maxAttempts: intOr(env.OTP_MAX_ATTEMPTS, 5),
      resendCooldownSeconds: intOr(env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    },

    whatsapp: {
      provider: optionalString(env.WHATSAPP_PROVIDER) ?? "mock",
      apiKey: optionalString(env.WHATSAPP_API_KEY),
    },

    email: {
      provider: optionalString(env.EMAIL_PROVIDER) ?? "mock",
      apiKey: optionalString(env.EMAIL_API_KEY),
    },

    storage: {
      provider: optionalString(env.STORAGE_PROVIDER) ?? "mock",
      bucket: optionalString(env.STORAGE_BUCKET),
      accessKey: optionalString(env.STORAGE_ACCESS_KEY),
      secretKey: optionalString(env.STORAGE_SECRET_KEY),
      // §25: жёсткий потолок на размер файла.
      maxFileSizeBytes: intOr(env.STORAGE_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024),
    },

    admin: {
      /**
       * Сессия админа живёт часами, а не месяцем, как пользовательская:
       * её компрометация стоит несравнимо дороже.
       */
      sessionMaxAgeHours: intOr(env.ADMIN_SESSION_MAX_AGE_HOURS, 8),
      /** Сколько неудачных попыток подряд блокируют вход (§51, §66). */
      maxLoginFailures: intOr(env.ADMIN_MAX_LOGIN_FAILURES, 5),
      loginWindowMinutes: intOr(env.ADMIN_LOGIN_WINDOW_MINUTES, 15),
    },

    reminders: {
      /**
       * Сколько раз пытаться отправить напоминание. Без предела неудачная
       * отправка повторялась бы на каждом запуске рассылки; после предела
       * напоминание отменяется, а причина остаётся в журнале уведомлений.
       */
      maxAttempts: intOr(env.REMINDER_MAX_ATTEMPTS, 3),
      /** Пауза между попытками, минуты. */
      retryAfterMinutes: intOr(env.REMINDER_RETRY_AFTER_MINUTES, 60),
      /** Сколько напоминаний обрабатывать за один запуск рассылки. */
      batchSize: intOr(env.REMINDER_BATCH_SIZE, 100),
    },

    sources: {
      /**
       * Через сколько дней проверка источника считается устаревшей (§32).
       *
       * Официальные процедуры и адреса страниц меняются. Источник, который
       * никто не открывал полгода, нельзя показывать как подтверждённый —
       * он и станет тем самым «выдуманным» для пользователя.
       */
      maxAgeDays: intOr(env.SOURCE_MAX_AGE_DAYS, 180),
      verifyTimeoutMs: intOr(env.SOURCE_VERIFY_TIMEOUT_MS, 15_000),
    },

    analytics: {
      // §57: сегменты меньше этого размера не показываются вообще.
      minGroupSize: intOr(env.ANALYTICS_MIN_GROUP_SIZE, 25),
    },

    retention: {
      documentDays: intOr(env.DOCUMENT_RETENTION_DAYS, 365),
      caseDays: intOr(env.CASE_RETENTION_DAYS, 1095),
      auditDays: intOr(env.AUDIT_RETENTION_DAYS, 730),
    },

    rateLimits: {
      globalPerMinute: intOr(env.RATE_LIMIT_GLOBAL_PER_MINUTE, 300),
      aiPerUserPerHour: intOr(env.RATE_LIMIT_AI_PER_USER_PER_HOUR, 60),
      documentsPerUserPerDay: intOr(env.RATE_LIMIT_DOCUMENTS_PER_USER_PER_DAY, 50),
      otpPerPhonePerHour: intOr(env.RATE_LIMIT_OTP_PER_PHONE_PER_HOUR, 5),
    },
  };
}

/**
 * Что обязано быть в production. В dev это только предупреждения: поднять
 * стенд без внешних провайдеров должно быть можно.
 */
function productionRequirements(config: AppConfig): string[] {
  const missing: string[] = [];

  if (!config.database.url) missing.push("DATABASE_URL");
  if (!config.session.secret || config.session.secret.length < 32) {
    missing.push("SESSION_SECRET (минимум 32 символа)");
  }
  if (!process.env.APP_URL?.trim()) missing.push("APP_URL");

  if (config.ai.provider === "openai" && !config.ai.openai.apiKey) {
    missing.push("OPENAI_API_KEY (выбран AI_PROVIDER=openai)");
  }
  if (config.ai.provider === "openai" && !config.ai.openai.model) {
    missing.push("OPENAI_MODEL (выбран AI_PROVIDER=openai)");
  }
  if (config.ai.provider === "anthropic" && !config.ai.anthropic.apiKey) {
    missing.push("ANTHROPIC_API_KEY (выбран AI_PROVIDER=anthropic)");
  }

  return missing;
}

let cached: AppConfig | null = null;

/**
 * Конфигурация приложения. В production бросает, если не хватает критичного:
 * запуск с пустым SESSION_SECRET означал бы подделываемые сессии.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const config = buildConfig(env);
  const missing = productionRequirements(config);

  if (config.isProduction && missing.length > 0) {
    throw new Error(
      `Не задана обязательная конфигурация production:\n  - ${missing.join("\n  - ")}\n` +
        "См. .env.example.",
    );
  }

  cached = config;
  return config;
}

/** Только для тестов: сбросить закешированную конфигурацию. */
export function resetConfigCache(): void {
  cached = null;
}

export { productionRequirements, buildConfig };
