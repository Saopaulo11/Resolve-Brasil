import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { CATEGORIES } from "../cases/categories";
import { trackEvent } from "../analytics/events";
import { renderPage } from "../utils/render";

/**
 * Приём описания случая с главной (§12, §20).
 *
 * Пока описание только принимается и проверяется. Классификация, вопросы и
 * план действий появятся на PHASE 3–4 — до тех пор страница честно говорит,
 * что разбора ещё нет. Правдоподобная заглушка была бы хуже пустоты: её
 * невозможно отличить от настоящего ответа модели (§9, §82).
 */
const schema = z.object({
  description: z
    .string()
    .trim()
    .min(20, "Conte um pouco mais: o que foi comprado, quando e o que deu errado.")
    .max(5000, "Texto muito longo. Resuma os pontos principais."),
});

const HOME_TITLE = "Resolve Brasil — Conte o que aconteceu. Descubra o que fazer.";
const HOME_DESCRIPTION =
  "Conte seu problema com suas próprias palavras. A IA ajuda você a entender " +
  "a situação, organizar as informações e encontrar os próximos passos.";

export function criar(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    // Введённый текст возвращается в форму: заставлять человека набирать
    // рассказ о проблеме заново — верный способ его потерять.
    res.status(400);
    renderPage(
      req,
      res,
      "home",
      {
        title: HOME_TITLE,
        description: HOME_DESCRIPTION,
        categories: CATEGORIES,
        values: {
          description: typeof body.description === "string" ? body.description : "",
        },
        errors: {
          description: parsed.error.issues[0]?.message ?? "Descrição inválida.",
        },
      },
      next,
    );
    return;
  }

  void trackEvent("case_started", { userId: req.session?.userId ?? null });

  renderPage(
    req,
    res,
    "caso-novo",
    {
      title: "Seu caso — Resolve Brasil",
      description: "Recebemos sua descrição.",
      caseDescription: parsed.data.description,
    },
    next,
  );
}
