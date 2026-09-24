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
 * каждой системе по-своему. Здесь человек видит, что именно он приложил:
 * снимок, имя, размер, состояние, — и может убрать лишнее до отправки.
 *
 * ГЛАВНОЕ ПРАВИЛО: выбор накапливается.
 *
 * Браузер при каждом новом выборе заменяет input.files целиком, а не
 * дополняет его. Поэтому единственный источник правды — список здесь, а
 * поле лишь получает его копию перед отправкой. Раньше обработчик сбрасывал
 * список в пустой и брал только что выбранное — из-за этого второй файл
 * вытеснял первый, и приложить больше одного было нельзя.
 *
 * Правка ничего не решает за сервер: предел размера и тип файла проверяются
 * там же, где и раньше. Здесь они только называются заранее.
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

  var ESTADOS = {
    pronto: "pronto para enviar",
    enviando: "Enviando…",
    grande: "acima do limite, não será enviado",
  };

  Array.prototype.forEach.call(blocos, function (bloco) {
    var entrada = bloco.querySelector("[data-upload-entrada]");
    var camera = bloco.querySelector("[data-upload-camera]");
    var lista = bloco.querySelector("[data-upload-lista]");
    var zona = bloco.querySelector("[data-upload-zona]");
    if (!entrada || !lista || !zona) return;

    // Без DataTransfer нельзя ни убрать файл из выбора, ни свести два поля
    // в одно. Нет его — оставляем родное поле как есть.
    if (typeof DataTransfer === "undefined") return;
    try {
      new DataTransfer();
    } catch (_erro) {
      return;
    }

    var maximo = Number(bloco.getAttribute("data-upload-max")) || 10;
    var limite = Number(bloco.getAttribute("data-upload-bytes")) || 0;

    /** [{ id, arquivo, estado }] — источник правды о выборе. */
    var escolhidos = [];
    var sequencia = 0;
    var previas = [];

    bloco.classList.add("upload--pronto");

    /** Копия накопленного списка уходит в поле — его и отправит форма. */
    var aplicar = function () {
      var pacote = new DataTransfer();
      escolhidos.forEach(function (item) {
        pacote.items.add(item.arquivo);
      });
      entrada.files = pacote.files;
      // Камеру очищаем: снимок уже переехал в основное поле, иначе он
      // уехал бы на сервер дважды.
      if (camera) camera.value = "";
    };

    var desenhar = function () {
      previas.forEach(function (url) {
        URL.revokeObjectURL(url);
      });
      previas = [];
      lista.textContent = "";

      escolhidos.forEach(function (item) {
        var arquivo = item.arquivo;

        var linha = document.createElement("li");
        linha.className = "upload__item";
        linha.setAttribute("data-upload-id", item.id);

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
        meta.textContent = tamanho(arquivo.size) + " · " + ESTADOS[item.estado];
        if (item.estado === "grande") meta.classList.add("upload__meta--erro");

        texto.appendChild(nome);
        texto.appendChild(meta);

        var remover = document.createElement("button");
        remover.type = "button";
        remover.className = "upload__remover";
        remover.setAttribute("aria-label", "Remover " + arquivo.name);
        remover.textContent = "Remover";
        // Убираем по идентификатору, а не по месту в списке: место меняется
        // при каждом добавлении, и обработчик, запомнивший старое, убрал бы
        // не тот файл.
        remover.addEventListener("click", function () {
          escolhidos = escolhidos.filter(function (atual) {
            return atual.id !== item.id;
          });
          aplicar();
          desenhar();
        });

        linha.appendChild(figura);
        linha.appendChild(texto);
        linha.appendChild(remover);
        lista.appendChild(linha);
      });

      if (escolhidos.length >= maximo) {
        var aviso = document.createElement("li");
        aviso.className = "upload__limite";
        aviso.textContent = "Máximo de " + maximo + " arquivos.";
        lista.appendChild(aviso);
      }
    };

    /** Дополняет накопленное, не заменяя его. */
    var adicionar = function (arquivos) {
      Array.prototype.forEach.call(arquivos, function (arquivo) {
        if (escolhidos.length >= maximo) return;

        // Один и тот же файл, выбранный дважды, — почти всегда промах.
        var repetido = escolhidos.some(function (atual) {
          return (
            atual.arquivo.name === arquivo.name &&
            atual.arquivo.size === arquivo.size
          );
        });
        if (repetido) return;

        sequencia += 1;
        escolhidos.push({
          id: "a" + sequencia,
          arquivo: arquivo,
          estado: limite > 0 && arquivo.size > limite ? "grande" : "pronto",
        });
      });

      aplicar();
      desenhar();
    };

    entrada.addEventListener("change", function () {
      // После выбора поле содержит ТОЛЬКО что выбрали сейчас — браузер
      // заменяет список целиком. Поэтому именно дополняем накопленное.
      adicionar(entrada.files);
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

    // На отправке подписи меняются: человек видит, что файлы поехали.
    var forma = bloco.closest("form");
    if (forma) {
      forma.addEventListener("submit", function () {
        escolhidos.forEach(function (item) {
          if (item.estado === "pronto") item.estado = "enviando";
        });
        desenhar();
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

/**
 * Регистрация service worker (§26).
 *
 * Нужен ради двух вещей: понятной страницы вместо ошибки браузера, когда
 * сети нет, и установки на телефон — браузер предлагает её только сайту с
 * обработчиком fetch, одного манифеста с иконками мало.
 *
 * Регистрируем после загрузки страницы: во время неё браузер и так занят
 * тем, что человек ждёт увидеть, а воркер пригодится не раньше следующего
 * захода. Отказ в регистрации молчаливый — сайт работает и без него, и
 * пугать человека сообщением о том, чего он не просил, незачем.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  });
}
