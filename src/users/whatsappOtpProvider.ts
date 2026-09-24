import { loadConfig } from "../config/env";
import { logger, maskPhone } from "../utils/logger";

import type { OtpProvider } from "./otpProvider";

/**
 * Доставка кода входа через WhatsApp Cloud API (§15, §79).
 *
 * В Бразилии WhatsApp есть практически у всех, и код туда доходит там, где
 * SMS теряется у оператора. Поэтому канал входа — он.
 *
 * Контракт запроса сверен с официальным SDK Meta (npm-пакет `whatsapp`,
 * сопровождает Meta): хост graph.facebook.com, путь
 * /{версия}/{phoneNumberId}/messages, заголовок Authorization: Bearer и тело
 * с messaging_product/recipient_type/to/type. Документация Meta в этой среде
 * закрыта правилом исходящего трафика, поэтому источником взят код SDK, а не
 * пересказ по памяти.
 *
 * Сообщение business-initiated, поэтому оно обязано быть шаблоном из
 * категории Authentication, заранее одобренным в кабинете Meta. Имя шаблона,
 * язык и версия API берутся из настроек: придумывать их за пользователя
 * нельзя — они заводятся в его кабинете.
 */

/** Сколько ждём Meta. Дольше — человек уже ушёл со страницы. */
const TIMEOUT_MS = 8000;

type MetaError = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

type MetaSuccess = { messages?: Array<{ id?: string }> };

/**
 * Кнопка шаблона Authentication.
 *
 * Такой шаблон у Meta обязан нести кнопку — «скопировать код» или автозаполнение,
 * и код повторяется в её параметре, иначе кнопка скопирует пустоту. Шаблоны
 * заводятся руками и бывают разными, поэтому поведение переключается
 * настройкой, а не зашито: несовпадение числа параметров Meta отвергает
 * целиком, и чинить это нужно без пересборки.
 */
function componentes(code: string, botao: string): unknown[] {
  const corpo = {
    type: "body",
    parameters: [{ type: "text", text: code }],
  };

  if (botao === "nenhum") return [corpo];

  return [
    corpo,
    {
      type: "button",
      sub_type: botao,
      index: 0,
      parameters: [{ type: "text", text: code }],
    },
  ];
}

export class WhatsappOtpProvider implements OtpProvider {
  readonly name = "whatsapp";

  async send(phone: string, code: string): Promise<{ delivered: boolean; error?: string }> {
    const { whatsapp } = loadConfig();

    // Провайдер не бросает исключений намеренно. Раньше сбой доставки
    // поднимался до обработчика и человек получал страницу «Algo deu errado»
    // вместо объяснения; здесь любой отказ — это delivered: false.
    const faltando = [
      !whatsapp.apiKey && "WHATSAPP_API_KEY",
      !whatsapp.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
      !whatsapp.apiVersion && "WHATSAPP_API_VERSION",
      !whatsapp.template && "WHATSAPP_TEMPLATE",
    ].filter((item): item is string => typeof item === "string");

    if (faltando.length > 0) {
      logger().error(
        { faltando },
        "WhatsApp: не хватает настроек для отправки кода",
      );
      return { delivered: false, error: "configuracao_incompleta" };
    }

    // Meta ждёт номер цифрами, без плюса.
    const destino = phone.replace(/\D/g, "");

    const url =
      `https://graph.facebook.com/${whatsapp.apiVersion}` +
      `/${whatsapp.phoneNumberId}/messages`;

    const corpo = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: destino,
      type: "template",
      template: {
        name: whatsapp.template,
        language: { code: whatsapp.language },
        components: componentes(code, whatsapp.otpButton),
      },
    };

    try {
      const resposta = await fetch(url, {
        method: "POST",
        headers: {
          // Ключ уходит только сюда: ни в лог, ни в ответ страницы (§76).
          authorization: `Bearer ${whatsapp.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const texto = await resposta.text();
      const dados = parse(texto);

      if (!resposta.ok) {
        const erro = (dados as MetaError).error;
        // Причину от Meta пишем в лог целиком: без неё «не отправилось»
        // неотличимо от неверного шаблона, чужого номера и просроченного
        // ключа. Кода в этом сообщении нет — только диагноз.
        logger().error(
          {
            phone: maskPhone(phone),
            status: resposta.status,
            metaCode: erro?.code,
            metaSubcode: erro?.error_subcode,
            metaMessage: erro?.message,
          },
          "WhatsApp отверг отправку кода",
        );
        return { delivered: false, error: `meta_${resposta.status}` };
      }

      const id = (dados as MetaSuccess).messages?.[0]?.id;
      if (!id) {
        logger().error(
          { phone: maskPhone(phone), status: resposta.status },
          "WhatsApp ответил успехом без идентификатора сообщения",
        );
        return { delivered: false, error: "resposta_inesperada" };
      }

      return { delivered: true };
    } catch (error) {
      // Сеть, таймаут, обрыв — всё сюда. Сообщение Meta здесь не появится,
      // поэтому пишем то, что есть, и отвечаем отказом, а не падением.
      logger().error(
        { phone: maskPhone(phone), err: mensagem(error) },
        "WhatsApp недоступен при отправке кода",
      );
      return { delivered: false, error: "indisponivel" };
    }
  }
}

function parse(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return {};
  }
}

function mensagem(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
