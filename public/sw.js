/**
 * Service worker (§26).
 *
 * Делает две вещи и намеренно не делает третью.
 *
 * Делает: держит в кэше неизменные файлы — стили, скрипт, иконки — и
 * показывает понятную страницу вместо ошибки браузера, когда сети нет. Из-за
 * обработчика fetch браузер начинает считать сайт устанавливаемым: одного
 * манифеста с иконками для этого мало.
 *
 * НЕ делает: не кладёт в кэш ни одной страницы. Страницы здесь собираются на
 * сервере и содержат токен формы, привязанный к сессии, а страница дела — ещё
 * и чужие персональные данные. Закэшированная страница на общем телефоне
 * показала бы одного человека другому, а токен из кэша не подошёл бы к новой
 * сессии, и отправка формы ломалась бы без объяснимой причины. Поэтому
 * кэшируется только то, что одинаково для всех.
 *
 * Список кэшируемого — разрешительный, а не запретительный. Запретительный
 * рано или поздно пропустит новый приватный маршрут: забыть добавить строку
 * легче, чем забыть разрешить.
 */

const CACHE = "resolve-brasil-estatico-v1";

/** Кладём при установке: без них страница «нет сети» будет голой. */
const PRECACHE = [
  "/offline.html",
  "/css/main.css",
  "/js/app.js",
  "/icons/icon-192.png",
  "/manifest.webmanifest",
];

/** Что вообще разрешено класть в кэш. Всё прочее идёт мимо. */
function cacheavel(pathname) {
  return (
    pathname.startsWith("/css/") ||
    pathname.startsWith("/js/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/images/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html"
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll падает целиком, если хоть один файл не отдался; по одному
      // надёжнее: отсутствие иконки не должно оставить сайт без страницы
      // «нет сети».
      .then(function (cache) {
        return Promise.all(
          PRECACHE.map(function (url) {
            return cache.add(url).catch(function () {});
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (nomes) {
        return Promise.all(
          nomes.map(function (nome) {
            return nome === CACHE ? null : caches.delete(nome);
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

/**
 * Отдаём из кэша и тут же обновляем.
 *
 * Версии в именах файлов нет, поэтому за свежесть отвечает фоновое
 * обновление: устаревший файл показывается один раз, следующая загрузка уже
 * новая. Так не нужно помнить о смене номера кэша при каждом выкате.
 */
function doCacheEDepoisRede(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (guardado) {
      const daRede = fetch(request)
        .then(function (resposta) {
          if (resposta && resposta.ok && resposta.type === "basic") {
            cache.put(request, resposta.clone());
          }
          return resposta;
        })
        .catch(function () {
          return guardado;
        });

      return guardado || daRede;
    });
  });
}

self.addEventListener("fetch", function (event) {
  const request = event.request;

  // Меняющие запросы через кэш не проходят никогда.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переход по страницам: только сеть. Нет сети — понятная страница вместо
  // ошибки браузера. В кэш страница не попадает ни при каком исходе.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match("/offline.html").then(function (offline) {
          return (
            offline ||
            new Response("Sem conexão.", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        });
      }),
    );
    return;
  }

  if (!cacheavel(url.pathname)) return;

  event.respondWith(doCacheEDepoisRede(request));
});
