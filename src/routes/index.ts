import { Router } from "express";

import * as cases from "../controllers/casesController";
import * as health from "../controllers/healthController";
import * as pages from "../controllers/pagesController";
import { findCategoryBySlug } from "../cases/categories";

/**
 * Публичные маршруты (§74).
 *
 * Личный кабинет (/minha-conta), вход (/entrar) и админка (/admin) приходят
 * на PHASE 2 и PHASE 10.
 */
export function buildRouter(): Router {
  const router = Router();

  router.get("/health", health.health);

  router.get("/", pages.home);
  router.get("/como-funciona", pages.comoFunciona);
  router.get("/categorias", pages.categorias);
  router.get("/sobre", pages.sobre);
  router.get("/privacidade", pages.privacidade);
  router.get("/termos", pages.termos);

  // Отдельная страница категории появится на PHASE 3 вместе с делами.
  // Пока ведём на главную: висящая ссылка хуже, чем честный редирект.
  router.get("/categorias/:slug", (req, res, next) => {
    const category = findCategoryBySlug(req.params.slug ?? "");
    if (!category) return next();
    return res.redirect(302, `/?categoria=${category.slug}`);
  });

  router.post("/caso/novo", cases.criar);

  return router;
}
