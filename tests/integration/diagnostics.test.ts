import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAiProviderCache } from "../../src/ai";
import { setOpenAiClient, type ResponsesLike } from "../../src/ai/openai/client";
import { resetConfigCache } from "../../src/config/env";
import { createHarness, type Harness } from "../helpers/auth";

/**
 * Диагностика production (§41).
 *
 * Главное свойство — не отдать секрет. Всё остальное бесполезно, если
 * ключ утечёт в ответ, который открывают по ссылке без входа.
 */

let harness: Harness;

const CHAVE = "sk-proj-CHAVE-DE-TESTE-QUE-NAO-DEVE-VAZAR-1234567890";

function usarOpenAi(extra: Record<string, string> = {}) {
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = CHAVE;
  process.env.OPENAI_MODEL = "modelo-de-teste";
  Object.assign(process.env, extra);
  resetConfigCache();
  resetAiProviderCache();
}

function cliente(resposta: unknown, erro?: unknown): ResponsesLike {
  return {
    responses: {
      async create() {
        if (erro) throw erro;
        return resposta as never;
      },
    },
  };
}

beforeEach(() => {
  resetConfigCache();
  resetAiProviderCache();
  harness = createHarness();
});

afterEach(() => {
  setOpenAiClient(null);
  vi.unstubAllGlobals();
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  resetConfigCache();
  resetAiProviderCache();
});

describe("GET /health/ai", () => {
  it("никогда не отдаёт ключ целиком", async () => {
    usarOpenAi();
    setOpenAiClient(cliente({ output_text: "OK" }));

    const resposta = await request(harness.app).get("/health/ai");
    const corpo = JSON.stringify(resposta.body);

    expect(resposta.status).toBe(200);
    expect(corpo).not.toContain(CHAVE);
    // И ни один достаточно длинный кусок ключа тоже.
    expect(corpo).not.toContain(CHAVE.slice(0, 12));
    expect(corpo).not.toContain("authorization");
  });

  it("показывает начало ключа и длину — этого хватает, чтобы отличить не тот ключ", async () => {
    usarOpenAi();
    setOpenAiClient(cliente({ output_text: "OK" }));

    const { body } = await request(harness.app).get("/health/ai");
    expect(body.apiKeyConfigured).toBe(true);
    expect(body.apiKeyPrefix).toBe(`sk-…(${CHAVE.length})`);
  });

  it("на удачном запросе сообщает успех и время", async () => {
    usarOpenAi();
    setOpenAiClient(cliente({ output_text: "OK" }));

    const { body } = await request(harness.app).get("/health/ai");
    expect(body.openaiRequest).toBe("success");
    expect(body.status).toBe(200);
    expect(typeof body.latencyMs).toBe("number");
    expect(body.model).toBe("modelo-de-teste");
  });

  it("различает просроченный ключ и превышенный лимит", async () => {
    // Ровно та разница, ради которой всё это и делается.
    for (const [status, esperado] of [
      [401, "AI_AUTH_ERROR"],
      [429, "AI_RATE_LIMIT_ERROR"],
      [500, "AI_PROVIDER_ERROR"],
    ] as const) {
      usarOpenAi();
      setOpenAiClient(cliente(null, Object.assign(new Error("falhou"), { status })));

      const { body } = await request(harness.app).get("/health/ai");
      expect(body.openaiRequest, String(status)).toBe("error");
      expect(body.status, String(status)).toBe(status);
      expect(body.errorCode, String(status)).toBe(esperado);
    }
  });

  it("без ключа прямо говорит, что дело в настройке", async () => {
    process.env.AI_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    process.env.OPENAI_MODEL = "modelo-de-teste";
    resetConfigCache();
    resetAiProviderCache();

    const { body } = await request(harness.app).get("/health/ai");
    expect(body.apiKeyConfigured).toBe(false);
    expect(body.apiKeyPrefix).toBeNull();
    expect(body.errorCode).toBe("AI_CONFIGURATION_ERROR");
  });

  it("?live=0 не ходит к провайдеру", async () => {
    usarOpenAi();
    let chamou = false;
    setOpenAiClient({
      responses: {
        async create() {
          chamou = true;
          return {} as never;
        },
      },
    });

    const { body } = await request(harness.app).get("/health/ai?live=0");
    expect(body.openaiRequest).toBe("skipped");
    expect(chamou).toBe(false);
  });
});

describe("GET /health/db", () => {
  it("без строки подключения отвечает прямо", async () => {
    const resposta = await request(harness.app).get("/health/db");

    expect(resposta.status).toBe(503);
    expect(resposta.body.configured).toBe(false);
    expect(resposta.body.errorCode).toBe("DATABASE_ERROR");
  });
});
