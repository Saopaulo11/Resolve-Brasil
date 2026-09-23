import type { NextFunction, Request, Response } from "express";

import { logger } from "../utils/logger";
import { renderPage } from "../utils/render";

/** 404 — единственный маршрут, до которого дошли все остальные. */
export function notFound(req: Request, res: Response, next: NextFunction): void {
  res.status(404);
  renderPage(
    req,
    res,
    "erro",
    {
      title: "Página não encontrada — Resolve Brasil",
      description: "A página que você procurou não existe.",
      heading: "Página não encontrada",
      message: "O endereço que você abriu não existe ou foi movido.",
    },
    next,
  );
}

/**
 * Обработчик ошибок. Наружу уходит текст без подробностей: сообщение
 * исключения может содержать фрагменты запроса, ключей и путей.
 */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isCsrf = error.message === "CSRF_TOKEN_INVALIDO";
  const isUpload = error.message === "UPLOAD_REJEITADO";
  const status = isCsrf ? 403 : isUpload ? 413 : 500;

  logger().error({ err: error, path: req.path, status }, "erro na requisição");

  if (res.headersSent) return;

  res.status(status);

  const locals = isCsrf
    ? {
        heading: "Sessão expirada",
        message:
          "Por segurança, recarregue a página e envie o formulário novamente.",
      }
    : isUpload
      ? {
          heading: "Arquivo não aceito",
          message:
            "O arquivo é grande demais ou foi enviado em um formato inesperado. " +
            "Envie um PDF, JPG, PNG ou WEBP dentro do limite de tamanho.",
        }
      : {
          heading: "Algo deu errado",
          message: "Tente novamente em instantes.",
        };

  // Макет сам может не отрендериться — тогда отдаём простой текст,
  // иначе обработчик ошибок уронит ответ второй раз.
  try {
    renderPage(req, res, "erro", {
      title: `${locals.heading} — Resolve Brasil`,
      description: locals.message,
      ...locals,
    });
  } catch {
    res.type("text/plain").send(locals.message);
  }
}
