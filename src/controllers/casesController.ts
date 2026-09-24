import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { CATEGORIES, findCategoryBySlug } from "../cases/categories";
import { runAnalysis, type AnalysisKind } from "../cases/analysisService";
import {
  DOCUMENT_KIND_LABELS,
  FACT_STATUS_LABELS,
  FACT_STATUS_TONE,
  fieldLabel,
} from "../documents/labels";
import {
  createCase,
  ESCALATION_ORDER,
  getCaseForUser,
  isClosedStatus,
  nextEscalation,
} from "../cases/caseService";
import { stores } from "../users/storeRegistry";
import { PIX_SITUATIONS, pixSituationDefinition } from "../cases/pix";
import { BRAZILIAN_STATES, stateName } from "../cases/states";
import { ESCALATION_LABELS, formatBRL, statusDefinition } from "../cases/status";
import { loadConfig } from "../config/env";
import { trackEvent } from "../analytics/events";
import { uploadDocuments, UPLOAD_MESSAGES } from "../documents/documentService";
import { uploadedFiles } from "../middleware/upload";
import { ipPrefix } from "../utils/crypto";
import { isValidPublicCaseId } from "../utils/ids";
import { logger } from "../utils/logger";
import { listReminders, PRESETS } from "../notifications/reminderService";
import { usableSources } from "../sources/sourceService";
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
  // Сообщение на самом z.string(), а не только на проверках длины: если поля
  // в теле запроса нет вовсе, zod выдаёт свой текст — по-английски и про типы.
  // Форма помечена required, но на это нельзя полагаться: required живёт в
  // браузере, а POST приходит откуда угодно.
  description: z
    .string({ error: "Conte o que aconteceu para começarmos." })
    .trim()
    .min(20, "Conte um pouco mais: o que foi comprado, quando e o que deu errado.")
    .max(5000, "Texto muito longo. Resuma os pontos principais."),
  categoria: z.string().max(80).optional(),
});

const HOME_TITLE = "Resolve Brasil — Conte o que aconteceu. Descubra o que fazer.";
const HOME_DESCRIPTION =
  "Conte seu problema com suas próprias palavras. A IA ajuda você a entender " +
  "a situação, organizar as informações e encontrar os próximos passos.";

/**
 * Возврат на главную с сохранённым рассказом.
 *
 * Общий для всех исходов, кроме успеха: и отказ проверки, и сбой на нашей
 * стороне возвращают человека к его же тексту, а не к пустой форме.
 */
function renderHome(
  req: Request,
  res: Response,
  next: NextFunction,
  state: {
    status: number;
    description?: string;
    categoria?: string;
    erroDeCampo?: string;
    falha?: { heading: string; message: string };
  },
): void {
  res.status(state.status);
  renderPage(
    req,
    res,
    "home",
    {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      categories: CATEGORIES,
      maxArquivos: loadConfig().storage.maxFilesPerUpload,
      values: { description: state.description ?? "" },
      errors: state.erroDeCampo ? { description: state.erroDeCampo } : {},
      selectedCategory: state.categoria ?? "",
      falha: state.falha ?? null,
    },
    next,
  );
}


/**
 * Прикрепление файлов, выбранных вместе с рассказом.
 *
 * Возвращает предупреждение, если что-то не прошло, и null, если всё в
 * порядке. Сбой самого хранилища не роняет создание дела: человек описал
 * проблему, и терять описание из-за неудавшегося вложения нельзя.
 */
async function anexarNaCriacao(input: {
  caseRecord: Awaited<ReturnType<typeof createCase>>;
  userId: string | null;
  files: ReturnType<typeof uploadedFiles>;
  ipPrefix: string | null;
}): Promise<string | null> {
  if (input.files.length === 0) return null;

  try {
    const resultado = await uploadDocuments({
      caseRecord: input.caseRecord,
      userId: input.userId,
      files: input.files,
      kind: "OUTRO",
      ipPrefix: input.ipPrefix,
    });

    if (resultado.recusados.length === 0) return null;

    return resultado.recusados
      .map((item) => `${item.filename}: ${UPLOAD_MESSAGES[item.reason]}`)
      .join(" ");
  } catch (error) {
    logger().error({ err: error, caseId: input.caseRecord.publicId }, "falha ao anexar arquivos");
    return "Não conseguimos anexar seus arquivos agora. Você pode enviá-los novamente nesta página.";
  }
}

export async function criar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = schema.safeParse(body);
  const relato = typeof body.description === "string" ? body.description : "";
  const categoria = typeof body.categoria === "string" ? body.categoria : "";

  if (!parsed.success) {
    // Введённый текст возвращается в форму: заставлять человека набирать
    // рассказ о проблеме заново — верный способ его потерять.
    renderHome(req, res, next, {
      status: 400,
      description: relato,
      categoria,
      erroDeCampo: parsed.error.issues[0]?.message ?? "Descrição inválida.",
    });
    return;
  }

  void trackEvent("case_started", { userId: req.session?.userId ?? null });

  const category = parsed.data.categoria
    ? (findCategoryBySlug(parsed.data.categoria)?.value ?? null)
    : null;

  let created;
  try {
    created = await createCase({
      userId: req.session?.userId ?? null,
      description: parsed.data.description,
      category,
    });
  } catch (error) {
    // Общая страница «Algo deu errado» здесь — тупик: рассказ, который
    // человек только что написал, пропадает вместе с ней, и вернуться ему
    // некуда. Подробности отказа остаются в журнале, наружу не уходят.
    logger().error({ err: error, path: req.path }, "falha ao criar o caso");
    renderHome(req, res, next, {
      status: 503,
      description: parsed.data.description,
      categoria,
      falha: {
        heading: "Não conseguimos analisar seu caso agora.",
        message: "Seus dados foram preservados. Tente novamente.",
      },
    });
    return;
  }

  // Файлы, приложенные прямо при вводе (§6). Дело уже создано, поэтому
  // отказ по какому-то из них его не отменяет: рассказ важнее вложения,
  // а про непринятый файл человеку скажут на странице дела.
  const anexos = await anexarNaCriacao({
    caseRecord: created,
    userId: req.session?.userId ?? null,
    files: uploadedFiles(req),
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  const target = `/caso/${created.publicId}`;

  if (req.session) {
    res.redirect(303, anexos ? `${target}?aviso=${encodeURIComponent(anexos)}` : target);
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
  const { cases, documents, facts } = stores();
  const messages = await cases.listMessages(found.case.id);
  const documentList = await documents.listForCase(found.case.id);
  const factList = await facts.listForCase(found.case.id);

  /**
   * Последний результат каждого вида: старые остаются в истории дела.
   *
   * Возвращается вместе с идентификатором сообщения — к нему привязывается
   * оценка пользователя (§52). Без идентификатора нельзя понять, что именно
   * человек оценил.
   */
  const latestMessage = (type: string) =>
    [...messages].reverse().find((message) => message.type === type) ?? null;

  const latest = (type: string) => latestMessage(type)?.metadata ?? null;

  // Одним запросом: по запросу на сообщение страница дела обращалась бы к
  // базе по разу на каждый ответ модели.
  const avaliados = await stores().feedback.ratedMessageIds(found.case.id, userId);

  renderPage(
    req,
    res,
    "caso",
    {
      title: `Caso ${found.case.publicId} — Resolve Brasil`,
      description: "Acompanhe o andamento do seu caso.",
      caso: found.case,
      // Предел берётся из конфигурации, а не пишется в шаблоне: иначе
      // подсказка и то, что на самом деле примет сервер, разъедутся.
      maxArquivos: loadConfig().storage.maxFilesPerUpload,
      statusLabel: status.label,
      statusHint: status.hint,
      statusTone: status.tone,
      escalationLabel: ESCALATION_LABELS[found.case.escalationLevel],
      // §19, §36: закрытое дело не предлагает действий, кроме возврата в
      // работу, а эскалация показывает только следующий шаг — остальные
      // каналы остаются доступны, но не навязываются.
      encerrado: isClosedStatus(found.case.status),
      // §57: только штат. Город не спрашивается — вместе с суммой и
      // категорией он опознаёт человека не хуже имени.
      estados: BRAZILIAN_STATES,
      estadoAtual: found.case.state,
      estadoNome: stateName(found.case.state),
      // §36: вопрос о Pix показывается только там, где платили через Pix.
      pix: found.case.paymentMethod === "PIX"
        ? {
            atual: found.case.pixSituation,
            atualLabel: found.case.pixSituation
              ? pixSituationDefinition(found.case.pixSituation).label
              : null,
            opcoes: PIX_SITUATIONS,
          }
        : null,
      canais: ESCALATION_ORDER.filter((level) => level !== "NENHUM").map((level) => ({
        valor: level,
        rotulo: ESCALATION_LABELS[level],
        atual: level === found.case.escalationLevel,
        sugerido: level === nextEscalation(found.case.escalationLevel),
      })),
      amountFormatted: formatBRL(found.case.amount),
      timeline: found.timeline,
      documentos: documentList.map((document) => ({
        id: document.id,
        filename: document.filename,
        kindLabel: DOCUMENT_KIND_LABELS[document.kind],
        sizeKb: Math.max(1, Math.round(document.fileSize / 1024)),
        extractionStatus: document.extractionStatus,
        createdAt: document.createdAt.toLocaleDateString("pt-BR"),
      })),
      fatos: factList
        // Отклонённые не показываем: человек уже сказал, что это не его данные.
        .filter((fact) => fact.status !== "REJECTED")
        .map((fact) => ({
          id: fact.id,
          label: fieldLabel(fact.field),
          value: fact.value,
          status: fact.status,
          statusLabel: FACT_STATUS_LABELS[fact.status],
          statusTone: FACT_STATUS_TONE[fact.status],
          confidence: fact.confidence === null ? null : Math.round(fact.confidence * 100),
        })),
      // §31: у каждого источника показывается дата, когда его в последний
      // раз открывали. Без неё ссылка выглядит вечно актуальной.
      fonteVerificada: await sourceVerificationDates(latest("PLANO_DE_ACAO")),
      classificacao: latest("CLASSIFICACAO"),
      perguntas: latest("PERGUNTAS"),
      plano: latest("PLANO_DE_ACAO"),
      rascunho: latest("RASCUNHO"),
      analiseResposta: latest("ANALISE_DE_RESPOSTA"),
      // Идентификаторы для формы оценки и отметка о том, что уже оценено.
      mensagemId: {
        classificacao: latestMessage("CLASSIFICACAO")?.id ?? null,
        plano: latestMessage("PLANO_DE_ACAO")?.id ?? null,
        analiseResposta: latestMessage("ANALISE_DE_RESPOSTA")?.id ?? null,
      },
      avaliados: [...avaliados],
      presets: PRESETS,
      lembretes: (await listReminders(found.case.id)).map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        status: reminder.status,
        scheduledAt: reminder.scheduledAt.toLocaleDateString("pt-BR"),
        pendente: reminder.status === "AGENDADO",
      })),
      aviso: typeof req.query.aviso === "string" ? req.query.aviso : null,
    },
    next,
  );
}

/**
 * Даты последней проверки для источников, попавших в план.
 *
 * Берутся из нашей базы, а не из ответа модели: дату проверки модель знать
 * не может, а выдуманная дата — это ровно то, что §32 запрещает.
 */
async function sourceVerificationDates(
  plan: unknown,
): Promise<Record<string, string>> {
  const sources = (plan as { sources?: Array<{ url?: unknown }> } | null)?.sources;
  if (!Array.isArray(sources) || sources.length === 0) return {};

  const stored = await usableSources();
  const byUrl = new Map(stored.map((source) => [source.url, source.lastVerifiedAt]));

  const dates: Record<string, string> = {};
  for (const source of sources) {
    if (typeof source.url !== "string") continue;
    const verifiedAt = byUrl.get(source.url);
    if (verifiedAt) dates[source.url] = verifiedAt.toLocaleDateString("pt-BR");
  }
  return dates;
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
