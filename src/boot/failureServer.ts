import http from "node:http";

/**
 * Ответ на несостоявшийся запуск.
 *
 * Если приложение не поднялось, платформе нечего показать, кроме собственной
 * страницы «функция не сработала» — без единого слова о причине. Логи среды
 * видны не всегда и не всем: у них своя выдача прав, и диагностика упирается
 * в перебор догадок. Поэтому сбой запуска превращается в ответ 503, который
 * причину называет. Ни один маршрут приложения при этом не обслуживается: на
 * любой запрос приходит одна и та же страница отказа.
 */

/** Переменные, без которых приложение в production не стартует. */
const ESPERADAS = [
  "NODE_ENV",
  "PORT",
  "APP_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  // Канал одноразовых кодов. Настраивается четырьмя переменными, и отказ
  // обычно в том, что заполнены не все: страница называет каждую отдельно,
  // иначе «OTP_PROVIDER задан, а старта нет» выглядит противоречием.
  "OTP_PROVIDER",
  "WHATSAPP_API_KEY",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_API_VERSION",
  "WHATSAPP_TEMPLATE",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM",
] as const;

/**
 * Текст ошибки наружу идёт очищенным. В сообщение драйвера базы или
 * HTTP-клиента легко попадает строка подключения или ключ, а страница отказа
 * открыта всем — выносить туда такое нельзя (§6, §41).
 */
export function limparMensagem(valor: unknown): string {
  const texto = valor instanceof Error ? valor.message : String(valor);
  return texto
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redigido]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redigido]")
    .slice(0, 300);
}

/** Только имена и факт «задано / не задано». Значений здесь не бывает. */
function estadoDasVariaveis(): string {
  return ESPERADAS.map(
    (nome) => `  ${nome}: ${process.env[nome] ? "definida" : "AUSENTE"}`,
  ).join("\n");
}

export function corpoDaFalha(error: unknown): string {
  return (
    "Resolve Brasil está fora do ar por um erro de configuração.\n\n" +
    `Motivo: ${limparMensagem(error)}\n\n` +
    "Variáveis de ambiente:\n" +
    `${estadoDasVariaveis()}\n`
  );
}

export function startFailureServer(error: unknown): void {
  const corpo = corpoDaFalha(error);

  http
    .createServer((_req, res) => {
      res.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(corpo);
    })
    .listen(Number(process.env.PORT) || 3000);
}
