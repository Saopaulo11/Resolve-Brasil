/**
 * Запасная точка входа для платформы.
 *
 * Vercel ищет сервер сам, по именам файлов, и обычно берёт src/server.ts —
 * он зовёт listen(), а этого пресету Express достаточно. Этот файл нужен на
 * случай, когда платформа предпочтёт корень: собранное приложение лежит в
 * dist/, и запустить его больше неоткуда.
 *
 * Локально запуск другой: `npm start` зовёт dist/server.js напрямую.
 *
 * Своей защиты от сбоя запуска здесь ровно столько, сколько нельзя получить
 * изнутри: dist/server.js держит её сам, но если он не загрузился вовсе —
 * нет сборки, сломан модуль, — ловить некому, кроме этого файла.
 */
const http = require("node:http");

try {
  require("./dist/server.js");
} catch (error) {
  console.error("falha ao carregar a aplicação:", error);

  let corpo;
  try {
    // Тот же текст отказа, что и при сбое конфигурации, — один на оба случая.
    corpo = require("./dist/boot/failureServer.js").corpoDaFalha(error);
  } catch {
    // Не загрузился даже он: значит сборки нет. Подробностей не сочиняем.
    corpo =
      "Resolve Brasil está fora do ar: a aplicação não foi encontrada.\n" +
      "A build não produziu dist/server.js.\n";
  }

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
