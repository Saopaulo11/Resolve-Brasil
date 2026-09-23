import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AiError, setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { OpenAIProvider } from "../../src/ai/providers/OpenAIProvider";
import type { CaseContext } from "../../src/ai/providers/AIProvider";
import { resetConfigCache } from "../../src/config/env";

/**
 * Клиент-заглушка вместо сети. Проверяем нашу логику — сборку запроса,
 * валидацию ответа, отсев чужих ссылок — а не поведение чужого API.
 */
type Call = Record<string, unknown>;

function stubClient(reply: unknown, calls: Call[] = []): ResponsesLike {
  return {
    responses: {
      async create(body: Record<string, unknown>) {
        calls.push(body);
        return reply as never;
      },
    },
  };
}

function jsonReply(payload: unknown, usage = { input_tokens: 100, output_tokens: 20 }) {
  return { output_text: JSON.stringify(payload), usage };
}

const context: CaseContext = {
  publicId: "RB-ABC234",
  description: "Comprei um fone, paguei no Pix e não recebi.",
  category: null,
  subcategory: null,
  companyName: "Loja Exemplo",
  amount: "349.90",
  currency: "BRL",
  paymentMethod: "PIX",
  purchaseDate: "2026-09-10",
  promisedDate: "2026-09-15",
  status: "NOVO",
  confirmedFacts: [{ field: "order_number", value: "12345" }],
  timeline: [{ date: "2026-09-10", title: "Compra realizada" }],
};

const VALID_CLASSIFICATION = {
  category: "PRODUTO_NAO_RECEBIDO",
  subcategory: null,
  confidence: 0.82,
  missing_information: [],
  recommended_questions: [],
  risk_flags: [],
};

let provider: OpenAIProvider;

beforeEach(() => {
  resetConfigCache();
  process.env.OPENAI_API_KEY = "test-key-nao-real";
  process.env.OPENAI_MODEL = "modelo-de-teste";
  process.env.AI_PROVIDER = "openai";
  provider = new OpenAIProvider();
});

afterEach(() => {
  setOpenAiClient(null);
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.AI_PROVIDER;
  resetConfigCache();
});

describe("сборка запроса", () => {
  it("берёт модель из конфигурации, а не из кода", () => {
    // §40: имя модели не зашито нигде в коде.
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION), calls));

    return provider.classifyCase(context).then(() => {
      expect(calls[0]?.model).toBe("modelo-de-teste");
    });
  });

  it("просит структурированный ответ в строгом режиме", async () => {
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION), calls));

    await provider.classifyCase(context);

    const format = (calls[0]?.text as { format: Record<string, unknown> }).format;
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    expect(format.name).toBe("case_classification");
  });

  it("не разрешает провайдеру хранить переписку", async () => {
    // §47, §91: источник правды — наша база, а не история у провайдера.
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION), calls));

    await provider.classifyCase(context);
    expect(calls[0]?.store).toBe(false);
  });

  it("не отправляет модели персональных данных сверх контекста дела", async () => {
    // §47, §48: граница минимизации — сам тип CaseContext.
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION), calls));

    await provider.classifyCase(context);

    const payload = JSON.stringify(calls[0]);
    expect(payload).not.toContain("+55");
    expect(payload).not.toContain("@");
    expect(payload).not.toMatch(/\bCPF\b/);
  });

  it("передаёт версию промпта в метрику вызова", async () => {
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION)));
    const result = await provider.classifyCase(context);
    expect(result.meta.promptVersion).toBe("1");
    expect(result.meta.operation).toBe("classifyCase");
  });

  it("считает токены и время вызова", async () => {
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION)));
    const result = await provider.classifyCase(context);
    expect(result.meta.inputTokens).toBe(100);
    expect(result.meta.outputTokens).toBe(20);
    expect(result.meta.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.meta.success).toBe(true);
  });
});

describe("проверка ответа модели (§8)", () => {
  it("возвращает разобранный результат", async () => {
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION)));
    const result = await provider.classifyCase(context);
    expect(result.data.category).toBe("PRODUTO_NAO_RECEBIDO");
    expect(result.data.confidence).toBeCloseTo(0.82);
  });

  it("отвергает выдуманную категорию", async () => {
    // Модель не имеет права изобрести категорию, которой нет в базе.
    setOpenAiClient(
      stubClient(jsonReply({ ...VALID_CLASSIFICATION, category: "INVENTADA" })),
    );
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "ESQUEMA_INVALIDO",
    });
  });

  it("отвергает лишнее поле", async () => {
    setOpenAiClient(
      stubClient(jsonReply({ ...VALID_CLASSIFICATION, surpresa: "extra" })),
    );
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "ESQUEMA_INVALIDO",
    });
  });

  it("отвергает превышение длины, которого нет в схеме для модели", async () => {
    // Пределы намеренно не уходят модели, но нашей валидацией проверяются.
    setOpenAiClient(
      stubClient(
        jsonReply({
          ...VALID_CLASSIFICATION,
          subcategory: "x".repeat(500),
        }),
      ),
    );
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "ESQUEMA_INVALIDO",
    });
  });

  it("отличает битый JSON от неверной схемы", async () => {
    setOpenAiClient(stubClient({ output_text: "{ isso não é json" }));
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "JSON_INVALIDO",
    });
  });

  it("отличает обрыв по лимиту токенов", async () => {
    // Лечится увеличением лимита, а не правкой схемы — потому и отдельный код.
    setOpenAiClient(
      stubClient({
        output_text: "{\"category\":",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    );
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "RESPOSTA_TRUNCADA",
    });
  });

  it("сообщает о пустом ответе", async () => {
    setOpenAiClient(stubClient({ output_text: "   " }));
    await expect(provider.classifyCase(context)).rejects.toMatchObject({
      code: "RESPOSTA_VAZIA",
    });
  });

  it("оборачивает сбой провайдера, не раскрывая подробностей наружу", async () => {
    setOpenAiClient({
      responses: {
        async create() {
          throw new Error("connect ECONNREFUSED 10.0.0.1:443");
        },
      },
    });

    const error = await provider.classifyCase(context).catch((e) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe("PROVEDOR_FALHOU");
    expect(error.message).not.toContain("10.0.0.1");
  });

  it("неудачный вызов тоже несёт метрику", async () => {
    // §45: по одним успехам не видно ни доли отказов, ни их причины.
    setOpenAiClient(stubClient(jsonReply({ ...VALID_CLASSIFICATION, confidence: 5 })));
    const error = await provider.classifyCase(context).catch((e) => e);
    expect(error.meta?.success).toBe(false);
    expect(error.meta?.errorCode).toBe("ESQUEMA_INVALIDO");
    expect(error.meta?.operation).toBe("classifyCase");
  });
});

describe("источники (§30)", () => {
  const candidates = [
    { organization: "gov.br", title: "Guia do consumidor", url: "https://www.gov.br/guia" },
  ];

  it("не вызывает модель, когда источников нет", async () => {
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply({ sources: [], not_found: true }), calls));

    const result = await provider.searchSources("prazo de entrega", null, []);

    expect(calls).toHaveLength(0);
    expect(result.data.not_found).toBe(true);
    expect(result.data.sources).toHaveLength(0);
  });

  it("выбрасывает ссылку, которой мы не давали", async () => {
    // Схема проверяет форму URL, а не его происхождение. Выдуманная ссылка
    // на gov.br — самая убедительная ошибка, какую может сделать модель.
    setOpenAiClient(
      stubClient(
        jsonReply({
          sources: [
            {
              organization: "gov.br",
              title: "Inventado",
              url: "https://www.gov.br/pagina-que-nao-demos",
              relevance: 0.99,
            },
          ],
          not_found: false,
        }),
      ),
    );

    const result = await provider.searchSources("prazo", null, candidates);
    expect(result.data.sources).toHaveLength(0);
    expect(result.data.not_found).toBe(true);
  });

  it("пропускает ссылку из списка", async () => {
    setOpenAiClient(
      stubClient(
        jsonReply({
          sources: [
            {
              organization: "gov.br",
              title: "Guia do consumidor",
              url: "https://www.gov.br/guia",
              relevance: 0.9,
            },
          ],
          not_found: false,
        }),
      ),
    );

    const result = await provider.searchSources("prazo", null, candidates);
    expect(result.data.sources).toHaveLength(1);
    expect(result.data.not_found).toBe(false);
  });

  it("список источников попадает в запрос дословно", async () => {
    const calls: Call[] = [];
    setOpenAiClient(
      stubClient(jsonReply({ sources: [], not_found: true }), calls),
    );

    await provider.searchSources("prazo", null, candidates);
    expect(String(calls[0]?.instructions)).toContain("https://www.gov.br/guia");
  });
});

describe("правила в системной части запроса", () => {
  it("запрещают выдумывать и обещать исход", async () => {
    const calls: Call[] = [];
    setOpenAiClient(stubClient(jsonReply(VALID_CLASSIFICATION), calls));

    await provider.classifyCase(context);
    const instructions = String(calls[0]?.instructions);

    expect(instructions).toContain("Nunca invente");
    expect(instructions).toContain("você certamente vai ganhar");
    expect(instructions).toContain("Não foi possível confirmar essa informação.");
    expect(instructions).toContain("não é advogado");
  });
});
