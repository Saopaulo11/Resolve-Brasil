import type { Request, Response } from "express";

import { CATEGORIES } from "../cases/categories";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "../cases/description";
import { loadConfig } from "../config/env";
import { trackEvent } from "../analytics/events";
import { renderPage } from "../utils/render";
import { megabytes } from "../utils/bytes";

const SLOGAN = "Conte o que aconteceu. Descubra o que fazer.";

export function home(req: Request, res: Response): void {
  void trackEvent("landing_view", { userId: req.session?.userId ?? null });

  renderPage(req, res, "home", {
    title: `Resolve Brasil — ${SLOGAN}`,
    description:
      "Conte seu problema com suas próprias palavras. A IA ajuda você a " +
      "entender a situação, organizar as informações e encontrar os próximos passos.",
    categories: CATEGORIES,
    maxArquivos: loadConfig().storage.maxFilesPerUpload,
    maxArquivoMb: megabytes(loadConfig().storage.maxFileSizeBytes),
    maxArquivoBytes: loadConfig().storage.maxFileSizeBytes,
    descricaoMin: DESCRIPTION_MIN,
    descricaoMax: DESCRIPTION_MAX,
    // Пришёл с карточки категории — форма это помнит и передаёт дальше.
    selectedCategory:
      typeof req.query.categoria === "string" ? req.query.categoria : "",
  });
}

export function comoFunciona(req: Request, res: Response): void {
  renderPage(req, res, "como-funciona", {
    title: "Como funciona — Resolve Brasil",
    description:
      "Do relato ao próximo passo: como o Resolve Brasil ajuda a organizar e " +
      "encaminhar um problema de consumo.",
  });
}

export function categorias(req: Request, res: Response): void {
  renderPage(req, res, "categorias", {
    title: "Categorias — Resolve Brasil",
    description: "Situações atendidas nesta primeira versão do Resolve Brasil.",
    categories: CATEGORIES,
  });
}

export function sobre(req: Request, res: Response): void {
  renderPage(req, res, "sobre", {
    title: "Sobre — Resolve Brasil",
    description: "O que o Resolve Brasil faz, e o que ele não é.",
  });
}

export function privacidade(req: Request, res: Response): void {
  renderPage(req, res, "privacidade", {
    title: "Privacidade — Resolve Brasil",
    description:
      "O que coletamos, por quê, por quanto tempo e quais são os seus direitos.",
  });
}

export function termos(req: Request, res: Response): void {
  renderPage(req, res, "termos", {
    title: "Termos de uso — Resolve Brasil",
    description: "Condições de uso do Resolve Brasil.",
  });
}
