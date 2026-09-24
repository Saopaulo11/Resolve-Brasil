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
/**
 * Счётчик символов под полем рассказа (§3).
 *
 * Без него человек упирается в предел молча: браузер просто перестаёт
 * принимать ввод, и это читается как поломка. Сервер проверяет те же
 * границы — счётчик их только показывает, ничего не решая сам.
 *
 * Без JavaScript под полем остаётся требование словами. Оно важнее
 * счётчика: понимать, чего от тебя ждут, нужно до того, как начал писать.
 */
document.addEventListener("input", function (event) {
  var campo = event.target;
  if (!campo || !campo.getAttribute || !campo.getAttribute("data-contador")) return;

  var saida = document.getElementById(campo.getAttribute("data-contador"));
  if (!saida) return;

  var minimo = Number(campo.getAttribute("minlength")) || 0;
  var maximo = Number(campo.getAttribute("maxlength")) || 0;
  var atual = campo.value.length;

  if (atual < minimo) {
    var faltam = minimo - atual;
    saida.textContent =
      faltam === 1 ? "Falta 1 caractere." : "Faltam " + faltam + " caracteres.";
  } else if (maximo > 0) {
    saida.textContent = atual + " / " + maximo + " caracteres";
  } else {
    saida.textContent = atual + " caracteres";
  }

  // Предупреждение появляется только у самого предела: постоянно жирный
  // счётчик отвлекает от того, ради чего человек сюда пришёл.
  var perto = maximo > 0 && atual > maximo - 200;
  saida.classList.toggle("field__contador--perto", perto);
});
