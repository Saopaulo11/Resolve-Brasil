import { loadConfig } from "../config/env";
import { logger, maskPhone } from "../utils/logger";

import type { OtpProvider } from "./otpProvider";

/**
 * Доставка кода входа обычным SMS через Twilio (§15, §79).
 *
 * Второй канал рядом с WhatsApp, а не замена ему. Причина не в надёжности:
 * шаблон категории Authentication в кабинете Meta проходит одобрение, и до
 * него войти нельзя вообще. У SMS такого шага нет — канал поднимается за тот
 * же вечер. Какой из двух работает, решает OTP_PROVIDER, и переключение стоит
 * одной переменной.
 *
 * Контракт запроса сверен с официальным SDK Twilio (npm-пакет `twilio`,
 * версия 6.1.1): хост api.twilio.com, путь
 * /2010-04-01/Accounts/{AccountSid}/Messages.json, тело как
 * application/x-www-form-urlencoded с полями To, From (или
 * MessagingServiceSid) и Body, доступ — HTTP Basic. Документация Twilio в
 * этой среде закрыта правилом исходящего трафика, поэтому источником взят код
 * SDK, а не пересказ по памяти.
 *
 * Своего кода Twilio не выдаёт и не проверяет: код рождается у нас, хранится
 * хешем и гаснет по нашим правилам (§67). Здесь только доставка — иначе срок
 * жизни и счётчик попыток жили бы в двух местах сразу.
 */

/** Сколько ждём Twilio. Дольше — человек уже ушёл со страницы. */
const TIMEOUT_MS = 8000;

type TwilioResposta = {
  sid?: string;
  status?: string;
  code?: number;
  message?: string;
  error_code?: number | null;
  error_message?: string | null;
};

/**
 * Текст сообщения.
 *
 * Срок берётся из настройки, а не пишется словами: разойдись он с настоящим
 * OTP_TTL_SECONDS — и сообщение начнёт врать человеку про его же код.
 */
function texto(code: string, ttlSeconds: number): string {
  const minutos = Math.max(1, Math.round(ttlSeconds / 60));
  return (
    `Resolve Brasil: seu codigo de acesso e ${code}. ` +
    `Vale por ${minutos} minuto${minutos === 1 ? "" : "s"}. Nao compartilhe com ninguem.`
  );
}

export class TwilioOtpProvider implements OtpProvider {
  readonly name = "twilio";

  async send(phone: string, code: string): Promise<{ delivered: boolean; error?: string }> {
    const config = loadConfig();
    const { twilio } = config;

    // Провайдер не бросает исключений намеренно — как и канал WhatsApp. Сбой
    // доставки, поднятый до обработчика, даёт человеку «Algo deu errado»:
    // страницу без объяснения, из которой не следует ни что случилось, ни что
    // делать. Здесь любой отказ — это delivered: false.
    const remetente = twilio.from ?? twilio.messagingServiceSid;
    const faltando = [
      !twilio.accountSid && "TWILIO_ACCOUNT_SID",
      !twilio.authToken && "TWILIO_AUTH_TOKEN",
      !remetente && "TWILIO_FROM (или TWILIO_MESSAGING_SERVICE_SID)",
    ].filter((item): item is string => typeof item === "string");

    if (faltando.length > 0) {
      logger().error({ faltando }, "Twilio: не хватает настроек для отправки кода");
      return { delivered: false, error: "configuracao_incompleta" };
    }

    const url =
      `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`;

    // Номер уходит в E.164 целиком, вместе с плюсом: так его ждёт Twilio.
    // (Meta, наоборот, требует одни цифры — отсюда разница с тем провайдером.)
    const corpo = new URLSearchParams({ To: phone, Body: texto(code, config.otp.ttlSeconds) });
    if (twilio.from) corpo.set("From", twilio.from);
    else if (twilio.messagingServiceSid) {
      corpo.set("MessagingServiceSid", twilio.messagingServiceSid);
    }

    try {
      const resposta = await fetch(url, {
        method: "POST",
        headers: {
          // Ключ уходит только сюда: ни в лог, ни в ответ страницы (§76).
          authorization: `Basic ${Buffer.from(
            `${twilio.accountSid}:${twilio.authToken}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: corpo.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const dados = parse(await resposta.text());

      if (!resposta.ok) {
        // Причину от Twilio пишем целиком: без неё «не отправилось»
        // неотличимо от неверного номера отправителя, чужого адреса и
        // просроченного ключа. Самого кода в этих полях нет — только диагноз.
        logger().error(
          {
            phone: maskPhone(phone),
            status: resposta.status,
            twilioCode: dados.code,
            twilioMessage: dados.message,
          },
          "Twilio отверг отправку кода",
        );
        return { delivered: false, error: `twilio_${resposta.status}` };
      }

      // Успех с кодом ошибки внутри бывает: запрос принят, сообщение —
      // нет. Считать это доставкой значило бы оставить человека ждать SMS,
      // которого не будет.
      if (dados.error_code) {
        logger().error(
          {
            phone: maskPhone(phone),
            twilioStatus: dados.status,
            twilioErrorCode: dados.error_code,
            twilioErrorMessage: dados.error_message,
          },
          "Twilio принял запрос, но сообщение не ушло",
        );
        return { delivered: false, error: `twilio_erro_${dados.error_code}` };
      }

      if (!dados.sid) {
        logger().error(
          { phone: maskPhone(phone), status: resposta.status },
          "Twilio ответил успехом без идентификатора сообщения",
        );
        return { delivered: false, error: "resposta_inesperada" };
      }

      return { delivered: true };
    } catch (error) {
      // Сеть, таймаут, обрыв — всё сюда. Ответа Twilio здесь не будет,
      // поэтому пишем то, что есть, и отвечаем отказом, а не падением.
      logger().error(
        { phone: maskPhone(phone), err: mensagem(error) },
        "Twilio недоступен при отправке кода",
      );
      return { delivered: false, error: "indisponivel" };
    }
  }
}

function parse(texto: string): TwilioResposta {
  try {
    return JSON.parse(texto) as TwilioResposta;
  } catch {
    return {};
  }
}

function mensagem(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
