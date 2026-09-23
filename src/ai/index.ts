import { loadConfig } from "../config/env";
import type { AIProvider } from "./providers/AIProvider";
import { MockAIProvider } from "./providers/MockAIProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";

/**
 * Выбор провайдера по конфигурации (§7, §40).
 *
 * Бизнес-логика зовёт только aiProvider() и не знает, кто за ним стоит.
 */
let instance: AIProvider | null = null;

export function aiProvider(): AIProvider {
  if (instance) return instance;

  const config = loadConfig();

  switch (config.ai.provider) {
    case "mock":
      instance = new MockAIProvider();
      return instance;

    case "openai":
      instance = new OpenAIProvider();
      return instance;

    case "anthropic":
      // Вторичный провайдер (§7) — для сравнения моделей и оценки качества.
      // Подменять его моком нельзя: мок вернёт пустой результат, это примут
      // за ответ модели, и провал интеграции останется незамеченным (§79).
      throw new Error(
        "AI_PROVIDER=anthropic: провайдер ещё не реализован. " +
          "Используйте openai или mock.",
      );

    default: {
      const exhaustive: never = config.ai.provider;
      throw new Error(`Неизвестный AI_PROVIDER: ${String(exhaustive)}`);
    }
  }
}

export function resetAiProviderCache(): void {
  instance = null;
}

export type { AIProvider };
