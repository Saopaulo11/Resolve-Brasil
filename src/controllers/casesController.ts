import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { CATEGORIES, findCategoryBySlug } from "../cases/categories";
import { runAnalysis, type AnalysisKind } from "../cases/analysisService";
import { createCase, getCaseForUser } from "../cases/caseService";
import { stores } from "../users/storeRegistry";
import { ESCALATION_LABELS, formatBRL, statusDefinition } from "../cases/status";
import { loadConfig } from "../config/env";
import { trackEvent } from "../analytics/events";
import { isValidPublicCaseId } from "../utils/ids";
import { renderPage } from "../utils/render";

/**
 * Дела (§20, §21, §22).
 *
 * Классификация, вопросы и план действий приходят на PHASE 4. До тех пор
 * страница дела показывает только то, что действительно известно: рассказ
 * пользователя и хронологию. Правдоподобная заглушка была бы хуже пустоты —
 * её невозможно отличить от настоящего ответа модели (§9, §82).
 */

/** Кука с номером дела, созданного до входа. Живёт минуты, не дни. */
export const PENDING_CASE_COOKIE = "rb_caso";
const PENDING_CASE_TTL_MS = 30 * 60_000;

const schema = z.object({
  description: z
    .string()
    .trim()
    .min(20, "Conte um pouco mais: o que foi comprado, quando e o que deu errado.")
    .max(5000, "Texto muito longo. Resuma os pontos principais."),
  categoria: z.string().max(80).optional(),
});

const HOME_TITLE = "Resolve Brasil — Conte o que aconteceu. Descubra o que fazer.";
const HOME_DESCRIPTION =
  "Conte seu problema com suas próprias palavras. A IA ajuda você a entender " +
  "a situação, organizar as informações e encontrar os próximos passos.";

export async function criar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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

  const category = parsed.data.categoria
    ? (findCategoryBySlug(parsed.data.categoria)?.value ?? null)
    : null;

  const created = await createCase({
    userId: req.session?.userId ?? null,
    description: parsed.data.description,
    category,
  });

  const target = `/caso/${created.publicId}`;

  if (req.session) {
    res.redirect(303, target);
    return;
  }

  // Не вошёл — дело уже создано, но без владельца. Номер кладём в
  // подписанную куку и ведём на вход; привязка произойдёт после
  // подтверждения телефона (§15).
  const config = loadConfig();
  res.cookie(PENDING_CASE_COOKIE, created.publicId, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: PENDING_CASE_TTL_MS,
  });

  res.redirect(303, `/entrar?next=${encodeURIComponent(target)}`);
}

export async function ver(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  // Express 5 типизирует параметр как string | string[]: повторённый
  // параметр в адресе даёт массив. Берём только строку.
  const raw = req.params.publicId;
  const publicId = typeof raw === "string" ? raw : "";

  // Неверный формат номера до базы не доходит.
  if (!isValidPublicCaseId(publicId)) return next();

  const found = await getCaseForUser(publicId, userId);

  // Чужое дело и несуществующее дело дают одинаковый 404: ответ «403»
  // подтвердил бы, что такой номер существует.
  if (!found) return next();

  const status = statusDefinition(found.case.status);
  const messages = await stores().cases.listMessages(found.case.id);

  /** Последний результат каждого вида: старые остаются в истории дела. */
  const latest = (type: string) =>
    [...messages].reverse().find((message) => message.type === type)?.metadata ?? null;

  renderPage(
    req,
    res,
    "caso",
    {
      title: `Caso ${found.case.publicId} — Resolve Brasil`,
      description: "Acompanhe o andamento do seu caso.",
      caso: found.case,
      statusLabel: status.label,
      statusHint: status.hint,
      statusTone: status.tone,
      escalationLabel: ESCALATION_LABELS[found.case.escalationLevel],
      amountFormatted: formatBRL(found.case.amount),
      timeline: found.timeline,
      classificacao: latest("CLASSIFICACAO"),
      perguntas: latest("PERGUNTAS"),
      plano: latest("PLANO_DE_ACAO"),
      rascunho: latest("RASCUNHO"),
      aviso: typeof req.query.aviso === "string" ? req.query.aviso : null,
    },
    next,
  );
}

const ANALYSIS_KINDS: readonly AnalysisKind[] = [
  "classificar",
  "perguntas",
  "plano",
  "rascunho",
];

/**
 * Запуск анализа (§8).
 *
 * Результат сохраняется сообщением дела, а страница перечитывается заново:
 * так обновление страницы не запускает повторный платный вызов модели.
 */
export async function analisar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return;
  }

  const raw = req.params.publicId;
  const publicId = typeof raw === "string" ? raw : "";
  if (!isValidPublicCaseId(publicId)) return next();

  const found = await getCaseForUser(publicId, userId);
  if (!found) return next();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = ANALYSIS_KINDS.find((item) => item === body.tipo);
  if (!kind) return next();

  const outcome = await runAnalysis({
    caseRecord: found.case,
    timeline: found.timeline,
    userId,
    kind,
  });

  const target = `/caso/${publicId}`;
  if (outcome.ok) {
    res.redirect(303, target);
    return;
  }

  res.redirect(303, `${target}?aviso=${encodeURIComponent(outcome.detail)}`);
}
