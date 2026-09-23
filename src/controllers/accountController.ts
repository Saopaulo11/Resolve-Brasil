import type { NextFunction, Request, Response } from "express";

import { MARKETING_CHECKBOX_LABEL, setMarketingConsent } from "../privacy/consent";
import { trackEvent } from "../analytics/events";
import { formatBrazilianPhone } from "../utils/phone";
import { ipPrefix } from "../utils/crypto";
import { renderPage } from "../utils/render";
import { stores } from "../users/storeRegistry";

/**
 * Личный кабинет (§18).
 *
 * Разделы: Meus casos, Meus dados, Notificações, Privacidade, Sair.
 * Дела появятся на PHASE 3 — до тех пор раздел показывает пустое состояние,
 * а не придуманные карточки.
 */
export async function minhaConta(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const user = await stores().users.findById(userId);
  if (!user) {
    // Сессия есть, пользователя нет — сессия отозвана или база подменена.
    res.redirect(303, "/entrar");
    return;
  }

  renderPage(
    req,
    res,
    "minha-conta",
    {
      title: "Minha conta — Resolve Brasil",
      description: "Seus casos, seus dados e suas preferências.",
      phoneMasked: formatBrazilianPhone(user.phone),
      memberSince: user.createdAt.toLocaleDateString("pt-BR"),
      marketingConsent: user.marketingConsent,
      caseNotifications: user.caseNotifications,
      marketingLabel: MARKETING_CHECKBOX_LABEL,
      // PHASE 3: сюда придут настоящие дела.
      cases: [],
      saved: req.query.salvo === "1",
    },
    next,
  );
}

/**
 * Изменение маркетингового согласия (§17, §64).
 *
 * Сервисные уведомления по делу этим не затрагиваются: отказ от рассылки не
 * должен лишать человека сообщений о ходе его собственного дела.
 */
export async function atualizarMarketing(req: Request, res: Response): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const accepted = body.marketing === "on" || body.marketing === "true";

  await setMarketingConsent({
    userId,
    accepted,
    source: "MINHA_CONTA",
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  void trackEvent(accepted ? "marketing_opt_in" : "marketing_opt_out", { userId });

  res.redirect(303, "/minha-conta?salvo=1");
}

/** POST /marketing/unsubscribe — отписка одним действием (§64). */
export async function cancelarMarketing(req: Request, res: Response): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  await setMarketingConsent({
    userId,
    accepted: false,
    source: "MINHA_CONTA",
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  void trackEvent("marketing_opt_out", { userId });
  res.redirect(303, "/minha-conta?salvo=1");
}
