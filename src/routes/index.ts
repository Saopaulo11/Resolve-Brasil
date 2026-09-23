import { Router } from "express";

import * as account from "../controllers/accountController";
import * as admin from "../controllers/adminController";
import * as auth from "../controllers/authController";
import * as cases from "../controllers/casesController";
import * as documents from "../controllers/documentsController";
import * as reminders from "../controllers/remindersController";
import * as responses from "../controllers/responseController";
import * as health from "../controllers/healthController";
import * as pages from "../controllers/pagesController";
import { findCategoryBySlug } from "../cases/categories";
import { aiRateLimit, otpRequestRateLimit } from "../middleware/rateLimit";
import { requirePermission } from "../middleware/adminSession";
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
  router.get("/caso/:publicId", requireAuth(), cases.ver);
  // Вызовы модели платные и медленные — отдельный лимит (§46).
  router.post("/caso/:publicId/analisar", requireAuth(), aiRateLimit(), cases.analisar);

  // --- Документы (§23–§26) ---
  router.post("/caso/:publicId/documentos", requireAuth(), documents.enviar);
  router.get(
    "/caso/:publicId/documentos/:documentId",
    requireAuth(),
    documents.baixar,
  );
  router.post(
    "/caso/:publicId/documentos/:documentId/extrair",
    requireAuth(),
    aiRateLimit(),
    documents.extrair,
  );
  router.post("/caso/:publicId/fatos/:factId", requireAuth(), documents.revisarFato);

  // --- Администрирование (§50, §51) ---
  //
  // Вход отдельный от пользовательского: своя кука, своя таблица сессий,
  // свой срок жизни. Каждый раздел закрыт конкретным правом, а не общей
  // проверкой «это админ».
  router.get("/admin/entrar", admin.entrarForm);
  router.post("/admin/entrar", admin.entrar);
  router.post("/admin/sair", admin.sair);

  router.get("/admin", requirePermission("dashboard.view"), admin.painel);
  router.get("/admin/casos", requirePermission("cases.list"), admin.casos);
  router.get("/admin/analytics", requirePermission("analytics.view"), admin.analytics);
  router.get("/admin/auditoria", requirePermission("audit.view"), admin.auditoria);

  // --- Напоминания (§37) ---
  router.post("/caso/:publicId/lembretes", requireAuth(), reminders.criar);
  router.post(
    "/caso/:publicId/lembretes/:reminderId/cancelar",
    requireAuth(),
    reminders.cancelar,
  );

  // --- Ответ компании (§35) ---
  router.post("/caso/:publicId/resposta", requireAuth(), aiRateLimit(), responses.receber);

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
