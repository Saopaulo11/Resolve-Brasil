import { Router } from "express";

import * as account from "../controllers/accountController";
import * as auth from "../controllers/authController";
import * as cases from "../controllers/casesController";
import * as health from "../controllers/healthController";
import * as pages from "../controllers/pagesController";
import { findCategoryBySlug } from "../cases/categories";
import { otpRequestRateLimit } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/session";

/**
 * Маршруты приложения (§74).
 *
 * Админка (/admin) приходит на PHASE 10.
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

  // §64 перечисляет /privacy и /terms по-английски, §74 — те же страницы
  // по-португальски. Каноничны португальские, английские ведут на них:
  // две разные страницы с одним текстом разъедутся при первой же правке.
  router.get("/privacy", (_req, res) => res.redirect(301, "/privacidade"));
  router.get("/terms", (_req, res) => res.redirect(301, "/termos"));

  // --- Вход (§15) ---
  router.get("/entrar", auth.telefoneForm);
  router.post("/entrar", otpRequestRateLimit(), auth.enviarCodigo);
  router.get("/entrar/codigo", auth.codigoForm);
  router.post("/entrar/codigo", auth.confirmarCodigo);
  router.post("/sair", auth.sair);

  // --- Личный кабинет (§18) ---
  router.get("/minha-conta", requireAuth(), account.minhaConta);
  router.post("/minha-conta/notificacoes", requireAuth(), account.atualizarMarketing);
  router.post("/marketing/unsubscribe", requireAuth(), account.cancelarMarketing);

  return router;
}
