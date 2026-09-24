/**
 * Точка входа для Vercel.
 *
 * Vercel ищет сервер в корне проекта и подхватывает его по вызову listen().
 * Собранное приложение лежит в dist/, поэтому корневой файл просто
 * запускает его — без этого пресет Express не находит, что запускать.
 *
 * Локально запуск остаётся прежним: `npm start` зовёт dist/server.js
 * напрямую, без обёртки ниже.
 *
 * Обёртка нужна ровно для одного: если приложение не поднялось, платформе
 * нечего показать, кроме собственной страницы «функция не сработала» — без
 * единого слова о причине. А логи среды видны не всегда и не всем. Поэтому
 * сбой запуска здесь превращается в ответ 503, который называет причину.
 * Приложение при этом не обслуживает ни одного своего маршрута: на любой
 * запрос приходит одна и та же страница отказа.
 */
const http = require("node:http");

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
];

/**
 * Текст ошибки наружу идёт очищенным. В сообщение драйвера базы или
 * HTTP-клиента легко попадает строка подключения или ключ — страница
 * отказа открыта всем, и выносить туда такое нельзя.
 */
function limpar(texto) {
  return String(texto)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redigido]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redigido]")
    .slice(0, 300);
}

/** Только имена и факт «задано / не задано». Значений здесь не бывает. */
function estadoDasVariaveis() {
  return ESPERADAS.map(
    (nome) => `  ${nome}: ${process.env[nome] ? "definida" : "AUSENTE"}`,
  ).join("\n");
}

try {
  require("./dist/server.js");
} catch (error) {
  const detalhe = limpar(error && error.message ? error.message : error);

  console.error("falha ao iniciar a aplicação:", error);

  const corpo =
    "Resolve Brasil está fora do ar por um erro de configuração.\n\n" +
    `Motivo: ${detalhe}\n\n` +
    "Variáveis de ambiente:\n" +
    `${estadoDasVariaveis()}\n`;

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
