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

/**
 * Отсчёт до повторной отправки кода (§67).
 *
 * Сервер отдаёт остаток паузы в data-reenvio и сам её применяет: скрипт
 * ничего не решает, он показывает. Кнопка блокируется здесь, а не в разметке
 * — если скрипт не выполнится, кнопка останется рабочей, и отказ придёт с
 * сервера тем же текстом. Мёртвой кнопки не бывает ни при каком исходе.
 */
(function () {
  var forma = document.querySelector("[data-reenvio]");
  if (!forma) return;

  var restante = Number(forma.getAttribute("data-reenvio")) || 0;
  var botao = forma.querySelector("[data-reenvio-botao]");
  var aviso = forma.querySelector("[data-reenvio-aviso]");
  if (!botao || !aviso || restante <= 0) return;

  var texto = function (segundos) {
    return "Você poderá solicitar um novo código em " + segundos + " segundos.";
  };

  var liberar = function () {
    botao.disabled = false;
    botao.removeAttribute("aria-disabled");
    aviso.textContent = "";
  };

  botao.disabled = true;
  botao.setAttribute("aria-disabled", "true");
  aviso.textContent = texto(restante);

  var relogio = setInterval(function () {
    restante -= 1;

    if (restante <= 0) {
      clearInterval(relogio);
      liberar();
      return;
    }

    aviso.textContent = texto(restante);
  }, 1000);
})();

/**
 * Список выбранных вложений (§6).
 *
 * Родное поле выбора файла показывает только «N arquivos» и выглядит на
 * каждой системе по-своему — на части телефонов подписью на чужом языке.
 * Здесь человек видит, что именно он приложил: снимок, имя, размер, и может
 * убрать лишнее до отправки, а не после.
 *
 * Правка ничего не решает за сервер: предел размера и тип файла проверяются
 * там же, где и раньше. Здесь они только называются заранее, чтобы человек не
 * узнавал о них после долгой загрузки.
 *
 * Без этого скрипта остаётся обычное поле выбора файла, и форма работает.
 */
(function () {
  var blocos = document.querySelectorAll("[data-upload]");
  if (!blocos.length) return;

  var tamanho = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1).replace(".", ",") + " MB";
  };

  var ehImagem = function (arquivo) {
    return /^image\//.test(arquivo.type);
  };

  Array.prototype.forEach.call(blocos, function (bloco) {
    var entrada = bloco.querySelector("[data-upload-entrada]");
    var camera = bloco.querySelector("[data-upload-camera]");
    var lista = bloco.querySelector("[data-upload-lista]");
    var zona = bloco.querySelector("[data-upload-zona]");
    if (!entrada || !lista || !zona) return;

    // Поддержка DataTransfer обязательна: без неё нельзя ни убрать файл из
    // выбора, ни свести два поля в одно. Нет её — оставляем родное поле.
    if (typeof DataTransfer === "undefined") return;
    try {
      new DataTransfer();
    } catch (_erro) {
      return;
    }

    var maximo = Number(bloco.getAttribute("data-upload-max")) || 10;
    var limite = Number(bloco.getAttribute("data-upload-bytes")) || 0;
    var escolhidos = [];
    var previas = [];

    bloco.classList.add("upload--pronto");

    var aplicar = function () {
      var pacote = new DataTransfer();
      escolhidos.forEach(function (arquivo) {
        pacote.items.add(arquivo);
      });
      entrada.files = pacote.files;
      // Камеру очищаем: снимок уже переехал в основное поле, и иначе он
      // уехал бы на сервер дважды.
      if (camera) camera.value = "";
    };

    var desenhar = function () {
      previas.forEach(function (url) {
        URL.revokeObjectURL(url);
      });
      previas = [];
      lista.textContent = "";

      escolhidos.forEach(function (arquivo, indice) {
        var item = document.createElement("li");
        item.className = "upload__item";

        var figura = document.createElement("span");
        figura.className = "upload__miniatura";

        if (ehImagem(arquivo)) {
          var url = URL.createObjectURL(arquivo);
          previas.push(url);
          var img = document.createElement("img");
          img.src = url;
          img.alt = "";
          figura.appendChild(img);
        } else {
          figura.classList.add("upload__miniatura--pdf");
          figura.textContent = "PDF";
        }

        var texto = document.createElement("span");
        texto.className = "upload__dados";

        var nome = document.createElement("span");
        nome.className = "upload__nome";
        nome.textContent = arquivo.name;

        var meta = document.createElement("span");
        meta.className = "upload__meta";

        if (limite > 0 && arquivo.size > limite) {
          meta.classList.add("upload__meta--erro");
          meta.textContent =
            tamanho(arquivo.size) + " · acima do limite, não será enviado";
        } else {
          meta.textContent = tamanho(arquivo.size) + " · pronto para enviar";
        }

        texto.appendChild(nome);
        texto.appendChild(meta);

        var remover = document.createElement("button");
        remover.type = "button";
        remover.className = "upload__remover";
        remover.setAttribute("aria-label", "Remover " + arquivo.name);
        remover.textContent = "Remover";
        remover.addEventListener("click", function () {
          escolhidos.splice(indice, 1);
          aplicar();
          desenhar();
        });

        item.appendChild(figura);
        item.appendChild(texto);
        item.appendChild(remover);
        lista.appendChild(item);
      });

      if (escolhidos.length >= maximo) {
        var aviso = document.createElement("li");
        aviso.className = "upload__limite";
        aviso.textContent = "Máximo de " + maximo + " arquivos.";
        lista.appendChild(aviso);
      }
    };

    var adicionar = function (arquivos) {
      Array.prototype.forEach.call(arquivos, function (arquivo) {
        if (escolhidos.length >= maximo) return;
        // Один и тот же файл, выбранный дважды, — почти всегда промах.
        var repetido = escolhidos.some(function (atual) {
          return atual.name === arquivo.name && atual.size === arquivo.size;
        });
        if (!repetido) escolhidos.push(arquivo);
      });
      aplicar();
      desenhar();
    };

    entrada.addEventListener("change", function () {
      // Файлы уже в поле: берём их как есть, иначе собственное присваивание
      // ниже затёрло бы выбор.
      var novos = Array.prototype.slice.call(entrada.files);
      escolhidos = [];
      adicionar(novos);
    });

    if (camera) {
      camera.addEventListener("change", function () {
        adicionar(camera.files);
      });
    }

    ["dragenter", "dragover"].forEach(function (evento) {
      zona.addEventListener(evento, function (e) {
        e.preventDefault();
        zona.classList.add("upload__zona--sobre");
      });
    });

    ["dragleave", "drop"].forEach(function (evento) {
      zona.addEventListener(evento, function (e) {
        e.preventDefault();
        zona.classList.remove("upload__zona--sobre");
      });
    });

    zona.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) adicionar(e.dataTransfer.files);
    });

    // На отправке подписи меняются: человек видит, что файлы поехали, а не
    // гадает, нажалась ли кнопка.
    var forma = bloco.closest("form");
    if (forma) {
      forma.addEventListener("submit", function () {
        var metas = lista.querySelectorAll(".upload__meta");
        Array.prototype.forEach.call(metas, function (meta) {
          if (meta.classList.contains("upload__meta--erro")) return;
          meta.textContent = "Enviando…";
        });
      });
    }
  });
})();

/**
 * Разбор дела идёт сам (§3).
 *
 * Сервер отдаёт форму со следующим шагом; здесь она отправляется без нажатия.
 * Один шаг на запрос: все четыре обращения к модели в один вызов функции не
 * укладываются.
 *
 * Кнопка остаётся в разметке и работает: без скрипта человек проходит шаги
 * сам. Поэтому она не прячется, а лишь блокируется на время отправки — чтобы
 * двойное нажатие не отправило шаг дважды.
 */
(function () {
  var forma = document.querySelector("[data-auto-analise]");
  if (!forma) return;

  var botao = forma.querySelector("[data-auto-analise-botao]");

  var enviar = function () {
    if (botao) {
      botao.disabled = true;
      botao.textContent = "Analisando…";
    }
    forma.submit();
  };

  forma.addEventListener("submit", function () {
    if (botao) botao.disabled = true;
  });

  // Небольшая задержка: страница успевает отрисоваться, и человек видит,
  // какой шаг сейчас идёт, а не мелькание.
  setTimeout(enviar, 600);
})();
