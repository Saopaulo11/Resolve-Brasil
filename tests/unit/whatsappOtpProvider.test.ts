import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { WhatsappOtpProvider } from "../../src/users/whatsappOtpProvider";

/**
 * Отправка кода через WhatsApp Cloud API.
 *
 * Запрос к Meta здесь подменён: проверяется то, что мы отправляем и как
 * переживаем отказ. Живой вызов сюда тащить нельзя — он стоит денег и
 * зависит от чужого кабинета.
 */

const salvo = { ...process.env };

function configurar(extra: Record<string, string> = {}) {
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_API_KEY = "token-de-teste";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_API_VERSION = "v21.0";
  process.env.WHATSAPP_TEMPLATE = "codigo_de_acesso";
  Object.assign(process.env, extra);
  resetConfigCache();
}

/** Подменяет fetch и возвращает то, что провайдер отправил. */
function interceptar(resposta: { status: number; body: unknown }) {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    return new Response(JSON.stringify(resposta.body), {
      status: resposta.status,
      headers: { "content-type": "application/json" },
    });
  });
  return chamadas;
}

const SUCESSO = { messages: [{ id: "wamid.TESTE" }] };

beforeEach(() => configurar());

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...salvo };
  resetConfigCache();
});

describe("WhatsApp как канал кода входа", () => {
  it("шлёт шаблон на нужный адрес и с нужным телом", async () => {
    const chamadas = interceptar({ status: 200, body: SUCESSO });

    const resultado = await new WhatsappOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(true);
    expect(chamadas).toHaveLength(1);

    const { url, init } = chamadas[0]!;
    // Путь собран из версии и идентификатора номера — так его описывает SDK Meta.
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789/messages");
    expect(init.method).toBe("POST");

    const corpo = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(corpo.messaging_product).toBe("whatsapp");
    expect(corpo.type).toBe("template");
    // Номер цифрами, без плюса.
    expect(corpo.to).toBe("5511987654321");

    const template = corpo.template as Record<string, unknown>;
    expect(template.name).toBe("codigo_de_acesso");
    expect(template.language).toEqual({ code: "pt_BR" });

    // Код идёт и в тело, и в кнопку: иначе кнопка скопирует пустоту.
    const componentes = template.components as Array<Record<string, unknown>>;
    expect(componentes).toHaveLength(2);
    expect(componentes[0]).toEqual({
      type: "body",
      parameters: [{ type: "text", text: "123456" }],
    });
    expect(componentes[1]).toMatchObject({ type: "button", sub_type: "url", index: 0 });
  });

  it("ключ уходит только в заголовок", async () => {
    const chamadas = interceptar({ status: 200, body: SUCESSO });
    await new WhatsappOtpProvider().send("+5511987654321", "123456");

    const { init } = chamadas[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-de-teste");
    // В теле запроса ключа быть не должно ни под каким видом (§76).
    expect(init.body as string).not.toContain("token-de-teste");
  });

  it("шаблон без кнопки отправляется одним компонентом", async () => {
    configurar({ WHATSAPP_OTP_BUTTON: "nenhum" });
    const chamadas = interceptar({ status: 200, body: SUCESSO });

    await new WhatsappOtpProvider().send("+5511987654321", "123456");
    const corpo = JSON.parse(chamadas[0]!.init.body as string) as Record<string, unknown>;
    const template = corpo.template as Record<string, unknown>;
    expect(template.components).toHaveLength(1);
  });

  it("отказ Meta не роняет вход, а возвращается отказом", async () => {
    // Раньше сбой доставки поднимался исключением, и человек получал
    // «Algo deu errado» вместо объяснения.
    interceptar({
      status: 400,
      body: { error: { message: "Template name does not exist", code: 132001 } },
    });

    const resultado = await new WhatsappOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("meta_400");
  });

  it("обрыв связи тоже отказ, а не исключение", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });

    const resultado = await new WhatsappOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("indisponivel");
  });

  it("успех без идентификатора сообщения успехом не считается", async () => {
    interceptar({ status: 200, body: { messages: [] } });

    const resultado = await new WhatsappOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("resposta_inesperada");
  });

  it("без настроек не ходит в сеть вообще", async () => {
    delete process.env.WHATSAPP_TEMPLATE;
    resetConfigCache();
    const chamadas = interceptar({ status: 200, body: SUCESSO });

    const resultado = await new WhatsappOtpProvider().send("+5511987654321", "123456");
    expect(resultado.delivered).toBe(false);
    expect(resultado.error).toBe("configuracao_incompleta");
    expect(chamadas).toHaveLength(0);
  });
});
