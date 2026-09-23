import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { login, logout } from "../admin/adminAuth";
import { permissionsFor, ROLE_LABELS } from "../admin/rbac";
import { internalReport } from "../analytics/aggregation";
import { findCategoryByValue } from "../cases/categories";
import { FEEDBACK_REASON_LABELS } from "../cases/feedbackLabels";
import { detectIndustry, INDUSTRY_LABELS } from "../companies/industry";
import { statusDefinition } from "../cases/status";
import { loadConfig } from "../config/env";
import { DOCUMENT_KIND_LABELS } from "../documents/labels";
import type { ExtractionStatus, NotificationStatus } from "../generated/prisma/enums";
import { ADMIN_COOKIE } from "../middleware/adminSession";
import { ipPrefix } from "../utils/crypto";
import { maskPhone } from "../utils/logger";
import { renderPage } from "../utils/render";
import { stores } from "../users/storeRegistry";

/**
 * Администрирование (§50, §51).
 *
 * Страницы намеренно показывают минимум: номер дела, категорию, статус,
 * дату. Ни текста обращения, ни телефона, ни документов — сотруднику они
 * для работы не нужны, а показанные однажды они показаны всегда.
 */
const LIST_LIMIT = 100;

/** Окно, за которое считаются итоги расхода на модель. */
const USAGE_WINDOW_DAYS = 30;

const EXTRACTION_LABELS: Record<ExtractionStatus, string> = {
  PENDENTE: "Aguardando",
  PROCESSANDO: "Em leitura",
  CONCLUIDA: "Lido",
  FALHOU: "Falhou",
  NAO_APLICAVEL: "Não se aplica",
};

const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  PENDENTE: "Na fila",
  ENVIADA: "Entregue",
  FALHOU: "Falhou",
  CANCELADA: "Cancelada",
};

function adminPage(
  req: Request,
  res: Response,
  view: string,
  locals: Record<string, unknown> & { title: string },
  next?: NextFunction,
): void {
  renderPage(
    req,
    res,
    view,
    {
      layout: "admin" as const,
      description: "Área administrativa do Resolve Brasil.",
      adminEmail: req.admin?.email ?? null,
      adminRole: req.admin ? ROLE_LABELS[req.admin.role] : null,
      adminPermissions: req.admin ? permissionsFor(req.admin.role) : [],
      ...locals,
    },
    next,
  );
}

// --- Вход -------------------------------------------------------------------

export function entrarForm(req: Request, res: Response): void {
  if (req.admin) {
    res.redirect(303, "/admin");
    return;
  }

  adminPage(req, res, "admin/entrar", {
    title: "Entrar — Administração",
    values: {},
    errors: {},
  });
}

const loginSchema = z.object({
  email: z.string().trim().max(200),
  senha: z.string().max(200),
});

export async function entrar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = loginSchema.safeParse(req.body ?? {});

  const fail = (message: string) => {
    res.status(401);
    adminPage(
      req,
      res,
      "admin/entrar",
      {
        title: "Entrar — Administração",
        values: { email: parsed.success ? parsed.data.email : "" },
        errors: { form: message },
      },
      next,
    );
  };

  // Формулировка одна на все случаи: разные сообщения отвечали бы на
  // вопрос, заведена ли такая учётная запись.
  if (!parsed.success) return fail("E-mail ou senha inválidos.");

  const result = await login(parsed.data.email, parsed.data.senha, {
    ipPrefix: ipPrefix(req.ip) ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (!result.ok) {
    if (result.reason === "bloqueado") {
      return fail("Muitas tentativas. Aguarde antes de tentar novamente.");
    }
    return fail("E-mail ou senha inválidos.");
  }

  const config = loadConfig();
  res.cookie(ADMIN_COOKIE, result.token, {
    httpOnly: true,
    signed: true,
    sameSite: "strict",
    secure: config.isProduction,
    // Кука ограничена разделом админки: на публичных страницах она не нужна
    // и не должна там оказаться.
    path: "/admin",
    maxAge: config.admin.sessionMaxAgeHours * 60 * 60_000,
  });

  res.redirect(303, "/admin");
}

export async function sair(req: Request, res: Response): Promise<void> {
  const token = req.signedCookies?.[ADMIN_COOKIE];
  if (typeof token === "string" && token.length > 0) await logout(token);

  res.clearCookie(ADMIN_COOKIE, { path: "/admin" });
  res.redirect(303, "/admin/entrar");
}

// --- Разделы ----------------------------------------------------------------

export async function painel(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const report = await internalReport();

  adminPage(
    req,
    res,
    "admin/painel",
    {
      title: "Painel — Administração",
      resumo: report.summary,
      minGroupSize: report.minGroupSize,
    },
    next,
  );
}

export async function casos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const list = await stores().cases.listRecent(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/casos",
    {
      title: "Casos — Administração",
      limite: LIST_LIMIT,
      casos: list.map((item) => {
        const status = statusDefinition(item.status);
        return {
          publicId: item.publicId,
          categoria:
            (item.category && findCategoryByValue(item.category)?.label) ??
            "Não classificado",
          empresa: item.companyName ?? "—",
          status: status.label,
          statusTone: status.tone,
          criadoEm: item.createdAt.toLocaleDateString("pt-BR"),
        };
      }),
    },
    next,
  );
}

export async function analytics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const report = await internalReport();

  adminPage(
    req,
    res,
    "admin/analytics",
    {
      title: "Analytics — Administração",
      relatorio: report,
      grupos: [
        { titulo: "Por categoria", dados: report.byCategory },
        { titulo: "Por setor", dados: report.byIndustry },
        { titulo: "Por forma de pagamento", dados: report.byPaymentMethod },
        { titulo: "Por faixa de valor", dados: report.byAmountBucket },
        { titulo: "Por mês", dados: report.byMonth },
        { titulo: "Por estado", dados: report.byState },
      ],
    },
    next,
  );
}

export async function auditoria(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const entries = await stores().audit.list(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/auditoria",
    {
      title: "Registros de acesso — Administração",
      limite: LIST_LIMIT,
      registros: entries.map((entry) => ({
        acao: entry.action,
        tipo: entry.entityType,
        entidade: entry.entityId ?? "—",
        quando: entry.createdAt.toLocaleString("pt-BR"),
        rede: entry.ipPrefix ?? "—",
      })),
    },
    next,
  );
}

// --- Usuários ---------------------------------------------------------------

/**
 * §50. Список людей, а не их дел.
 *
 * Телефон показывается только последними цифрами: сотруднику поддержки они
 * нужны, чтобы сверить, с кем он говорит, а полный номер — нет. Имени,
 * текста обращения и документов здесь нет вовсе.
 */
export async function usuarios(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { users, cases } = stores();
  const [list, total] = await Promise.all([users.listRecent(LIST_LIMIT), users.countAll()]);

  const rows = await Promise.all(
    list.map(async (user) => ({
      telefone: maskPhone(user.phone),
      verificado: user.phoneVerified,
      marketing: user.marketingConsent,
      casos: (await cases.listForUser(user.id)).length,
      criadoEm: user.createdAt.toLocaleDateString("pt-BR"),
    })),
  );

  adminPage(
    req,
    res,
    "admin/usuarios",
    {
      title: "Usuários — Administração",
      limite: LIST_LIMIT,
      total,
      usuarios: rows,
    },
    next,
  );
}

// --- Documentos -------------------------------------------------------------

/**
 * §25, §51. Только метаданные.
 *
 * Имени файла здесь нет намеренно: «cpf-joao.pdf» уже персональные данные,
 * а содержимое не выдаётся никакой роли (см. GRANTED_TO_NOBODY).
 */
export async function documentos(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const list = await stores().documents.listRecent(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/documentos",
    {
      title: "Documentos — Administração",
      limite: LIST_LIMIT,
      documentos: list.map((document) => ({
        tipo: DOCUMENT_KIND_LABELS[document.kind],
        tamanhoKb: Math.max(1, Math.round(document.fileSize / 1024)),
        formato: document.mimeType,
        extracao: EXTRACTION_LABELS[document.extractionStatus],
        verificacao: document.scanStatus ?? "não verificado",
        excluido: document.deletedAt !== null,
        criadoEm: document.createdAt.toLocaleString("pt-BR"),
      })),
    },
    next,
  );
}

// --- Chamadas de IA ---------------------------------------------------------

/** §45. Учёт вызовов: метрики и стоимость, без текста запросов и ответов. */
export async function ia(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { aiRequests } = stores();
  const desde = new Date(Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60_000);
  const [list, totais] = await Promise.all([
    aiRequests.listRecent(LIST_LIMIT),
    aiRequests.totals(desde),
  ]);

  adminPage(
    req,
    res,
    "admin/ia",
    {
      title: "Chamadas de IA — Administração",
      limite: LIST_LIMIT,
      janelaDias: USAGE_WINDOW_DAYS,
      totais,
      chamadas: list.map((row) => ({
        provedor: row.provider,
        modelo: row.model,
        operacao: row.operation,
        entrada: row.inputTokens,
        saida: row.outputTokens,
        custo: row.estimatedCost,
        latencia: row.latencyMs,
        sucesso: row.success,
        erro: row.errorCode,
        quando: row.createdAt.toLocaleString("pt-BR"),
      })),
    },
    next,
  );
}

// --- Fontes oficiais --------------------------------------------------------

/**
 * §29–§32. Перечень источников и состояние их проверки.
 *
 * Источник, который никто не открывал дольше срока, помечен здесь как
 * устаревший — и системой в дело не берётся. Проверка запускается командой
 * `npm run sources:verify`, а не кнопкой: она ходит во внешнюю сеть.
 */
export async function fontes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const config = loadConfig();
  const list = await stores().sources.listAll();
  const limite = new Date(Date.now() - config.sources.maxAgeDays * 24 * 60 * 60_000);

  adminPage(
    req,
    res,
    "admin/fontes",
    {
      title: "Fontes oficiais — Administração",
      maxAgeDays: config.sources.maxAgeDays,
      fontes: list.map((source) => {
        const verificada = source.lastVerifiedAt;
        const vencida = verificada !== null && verificada.getTime() < limite.getTime();
        return {
          organizacao: source.organization,
          titulo: source.title,
          url: source.url,
          ativa: source.active,
          verificadaEm: verificada ? verificada.toLocaleDateString("pt-BR") : null,
          estado: !source.active
            ? { rotulo: "Indisponível", tom: "aviso" }
            : verificada === null
              ? { rotulo: "Nunca verificada", tom: "neutro" }
              : vencida
                ? { rotulo: "Verificação vencida", tom: "aviso" }
                : { rotulo: "Em uso", tom: "concluido" },
        };
      }),
    },
    next,
  );
}

// --- Avaliações -------------------------------------------------------------

/**
 * §52. Оценки ответов AI.
 *
 * Без имени и телефона: для качества важно, что именно не сработало, а не
 * кто это сказал. Комментарий — свободный текст пользователя, поэтому
 * страница закрыта правом feedback.view и каждый вход в неё записывается.
 */
export async function avaliacoes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { feedback } = stores();
  const [list, contagem] = await Promise.all([
    feedback.listRecent(LIST_LIMIT),
    feedback.countByRating(),
  ]);

  const total = contagem.sim + contagem.nao;

  adminPage(
    req,
    res,
    "admin/avaliacoes",
    {
      title: "Avaliações — Administração",
      limite: LIST_LIMIT,
      contagem,
      total,
      // Доля считается только когда есть от чего считать: «100 % útil» при
      // одной оценке — цифра, которой нельзя пользоваться (§57).
      proporcaoUtil:
        total >= loadConfig().analytics.minGroupSize
          ? Math.round((contagem.sim / total) * 100)
          : null,
      minGroupSize: loadConfig().analytics.minGroupSize,
      avaliacoes: list.map((item) => ({
        avaliacao: item.rating === "SIM" ? "Ajudou" : "Não ajudou",
        util: item.rating === "SIM",
        motivo: item.reason ? FEEDBACK_REASON_LABELS[item.reason] : null,
        comentario: item.comment,
        quando: item.createdAt.toLocaleString("pt-BR"),
      })),
    },
    next,
  );
}

// --- Notificações -----------------------------------------------------------

/**
 * §37, §38. Наблюдение за доставкой.
 *
 * Содержимого сообщения здесь нет: для вопроса «дошло или нет» достаточно
 * канала, шаблона, состояния и ошибки.
 */
export async function notificacoes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const list = await stores().notifications.listRecent(LIST_LIMIT);

  adminPage(
    req,
    res,
    "admin/notificacoes",
    {
      title: "Notificações — Administração",
      limite: LIST_LIMIT,
      falhas: list.filter((item) => item.status === "FALHOU").length,
      notificacoes: list.map((item) => ({
        canal: item.channel,
        proposito: item.purpose === "SERVICO" ? "Sobre o caso" : "Novidades",
        modelo: item.template,
        estado: NOTIFICATION_STATUS_LABELS[item.status],
        falhou: item.status === "FALHOU",
        erro: item.error,
        quando: item.createdAt.toLocaleString("pt-BR"),
      })),
    },
    next,
  );
}

// --- Configurações ----------------------------------------------------------

/**
 * §41, §50. Действующая конфигурация.
 *
 * Значение секрета не показывается никогда и ни одной роли — только факт,
 * задан он или нет. Экран настроек, показывающий ключ, превращает любой
 * доступ в админку в утечку ключа.
 */
type Ajuste = { valor: string; ok: boolean | null };

function segredo(value: string | null | undefined): Ajuste {
  return value ? { valor: "Configurado", ok: true } : { valor: "Não configurado", ok: false };
}

function valor(text: string | number): Ajuste {
  return { valor: String(text), ok: null };
}

export function configuracoes(req: Request, res: Response, next: NextFunction): void {
  const config = loadConfig();

  const grupos = [
    {
      titulo: "Ambiente",
      itens: [
        { nome: "NODE_ENV", ...valor(config.nodeEnv) },
        { nome: "Endereço público", ...valor(config.appUrl) },
        { nome: "Banco de dados", ...segredo(config.database.url) },
        { nome: "Segredo de sessão", ...segredo(config.session.secret) },
      ],
    },
    {
      titulo: "Inteligência artificial",
      itens: [
        { nome: "Provedor", ...valor(config.ai.provider) },
        { nome: "Modelo OpenAI", ...valor(config.ai.openai.model ?? "não definido") },
        { nome: "Chave OpenAI", ...segredo(config.ai.openai.apiKey) },
        { nome: "Modelo Anthropic", ...valor(config.ai.anthropic.model ?? "não definido") },
        { nome: "Chave Anthropic", ...segredo(config.ai.anthropic.apiKey) },
        { nome: "Limite de saída (tokens)", ...valor(config.ai.maxOutputTokens) },
        {
          nome: "Confiança mínima da classificação",
          ...valor(config.ai.classificationMinConfidence),
        },
        {
          nome: "Preços por 1M de tokens",
          ...(config.ai.pricing.inputPerMillion === null ||
          config.ai.pricing.outputPerMillion === null
            ? { valor: "Não definidos — custo não é calculado", ok: false }
            : {
                valor: `entrada ${config.ai.pricing.inputPerMillion} / saída ${config.ai.pricing.outputPerMillion}`,
                ok: true,
              }),
        },
      ],
    },
    {
      titulo: "Envio de código e mensagens",
      itens: [
        { nome: "Provedor de OTP", ...valor(config.otp.provider) },
        { nome: "Chave de OTP", ...segredo(config.otp.apiKey) },
        { nome: "Validade do código (s)", ...valor(config.otp.ttlSeconds) },
        { nome: "Tentativas por código", ...valor(config.otp.maxAttempts) },
        { nome: "Provedor de WhatsApp", ...valor(config.whatsapp.provider) },
        { nome: "Chave de WhatsApp", ...segredo(config.whatsapp.apiKey) },
        { nome: "Provedor de e-mail", ...valor(config.email.provider) },
        { nome: "Chave de e-mail", ...segredo(config.email.apiKey) },
      ],
    },
    {
      titulo: "Documentos",
      itens: [
        { nome: "Provedor de armazenamento", ...valor(config.storage.provider) },
        { nome: "Bucket", ...valor(config.storage.bucket ?? "não definido") },
        { nome: "Credenciais do armazenamento", ...segredo(config.storage.secretKey) },
        {
          nome: "Tamanho máximo por arquivo",
          ...valor(`${Math.round(config.storage.maxFileSizeBytes / 1024 / 1024)} MB`),
        },
      ],
    },
    {
      titulo: "Fontes e analytics",
      itens: [
        { nome: "Validade da verificação (dias)", ...valor(config.sources.maxAgeDays) },
        { nome: "Grupo mínimo em analytics", ...valor(config.analytics.minGroupSize) },
      ],
    },
    {
      titulo: "Prazos de guarda e privacidade",
      itens: [
        { nome: "Documentos (dias)", ...valor(config.retention.documentDays) },
        { nome: "Casos encerrados (dias)", ...valor(config.retention.caseDays) },
        { nome: "Registros de acesso (dias)", ...valor(config.retention.auditDays) },
        { nome: "Carência da exclusão (dias)", ...valor(config.privacy.deletionGraceDays) },
      ],
    },
    {
      titulo: "Limites de uso",
      itens: [
        { nome: "Requisições por minuto", ...valor(config.rateLimits.globalPerMinute) },
        { nome: "IA por usuário/hora", ...valor(config.rateLimits.aiPerUserPerHour) },
        {
          nome: "Documentos por usuário/dia",
          ...valor(config.rateLimits.documentsPerUserPerDay),
        },
        { nome: "Códigos por telefone/hora", ...valor(config.rateLimits.otpPerPhonePerHour) },
      ],
    },
    {
      titulo: "Sessão administrativa",
      itens: [
        { nome: "Duração (horas)", ...valor(config.admin.sessionMaxAgeHours) },
        { nome: "Falhas até bloqueio", ...valor(config.admin.maxLoginFailures) },
        { nome: "Janela de bloqueio (min)", ...valor(config.admin.loginWindowMinutes) },
      ],
    },
  ];

  adminPage(req, res, "admin/configuracoes", { title: "Configurações — Administração", grupos }, next);
}

// --- Empresas ---------------------------------------------------------------

/**
 * §85, §86. Справочник компаний и их отрасли.
 *
 * Справочника настоящих компаний у нас нет: записи появляются только из
 * того, что назвали пользователи. Рядом с отраслью показывается слово, по
 * которому она определена, — без него ошибку правила невозможно заметить:
 * отрасль выглядит одинаково достоверно и когда угадана, и когда взята из
 * названия.
 */
export async function empresas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { companies } = stores();
  const list = await companies.listAll(LIST_LIMIT);

  const rows = await Promise.all(
    list.map(async (company) => {
      const guess = detectIndustry(company.canonicalName);
      const aliases = await companies.listAliases(company.id);

      return {
        nome: company.canonicalName,
        normalizado: company.normalized,
        setor: INDUSTRY_LABELS[company.industry],
        identificado: company.industry !== "OTHER",
        // Слово из названия, давшее отрасль. Пусто — значит не определено.
        evidencia: guess.evidence,
        apelidos: aliases.map((alias) => ({
          texto: alias.alias,
          revisado: alias.reviewed,
        })),
        criadoEm: company.createdAt.toLocaleDateString("pt-BR"),
      };
    }),
  );

  adminPage(
    req,
    res,
    "admin/empresas",
    {
      title: "Empresas — Administração",
      limite: LIST_LIMIT,
      empresas: rows,
    },
    next,
  );
}
