/**
 * Минимальный прогрессивный слой (§68).
 *
 * Скрипт внешний, а не встроенный: CSP запрещает inline-скрипты, и это
 * правильно — встроенный скрипт снимает главную защиту от XSS. Без
 * JavaScript страница работает полностью, теряется только кнопка «копировать».
 */
document.addEventListener("click", function (event) {
  var button = event.target.closest("[data-copy]");
  if (!button) return;

  var target = document.querySelector(button.getAttribute("data-copy"));
  if (!target) return;

  var done = function () {
    var original = button.textContent;
    button.textContent = "Copiado";
    setTimeout(function () {
      button.textContent = original;
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(target.value).then(done, function () {});
    return;
  }

  // Запасной путь для старых браузеров и небезопасного контекста.
  target.select();
  try {
    document.execCommand("copy");
    done();
  } catch (_error) {
    /* копирование недоступно — текст всё равно можно выделить вручную */
  }
});
