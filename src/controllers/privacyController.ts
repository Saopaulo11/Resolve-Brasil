import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { loadConfig } from "../config/env";
import { buildExport } from "../privacy/exportService";
import {
  cancelDeletion,
  pendingDeletion,
  requestDeletion,
} from "../privacy/deletionService";
import { ipPrefix } from "../utils/crypto";
import { renderPage } from "../utils/render";

/**
 * Центр приватности (§64).
 *
 * Одно место, где человек видит свои данные, забирает их и может потребовать
 * удаления. Разнесённые по интерфейсу такие возможности существуют
 * формально: найти их никто не может.
 */
function requireUser(req: Request, res: Response): string | null {
  const userId = req.session?.userId;
  if (!userId) {
    res.redirect(303, "/entrar");
    return null;
  }
  return userId;
}

export async function centro(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const config = loadConfig();
  const pending = await pendingDeletion(userId);

  renderPage(
    req,
    res,
    "privacidade-conta",
    {
      title: "Privacidade — Resolve Brasil",
      description: "Seus dados, sua exportação e o pedido de exclusão.",
      prazoDias: config.privacy.deletionGraceDays,
      retencao: {
        documentos: config.retention.documentDays,
        casos: config.retention.caseDays,
      },
      exclusaoPendente: pending
        ? {
            solicitadaEm: pending.requestedAt.toLocaleDateString("pt-BR"),
            executaApos: pending.executeAfter.toLocaleDateString("pt-BR"),
          }
        : null,
      aviso: typeof req.query.aviso === "string" ? req.query.aviso : null,
    },
    next,
  );
}

/**
 * Выгрузка данных файлом.
 *
 * Отдаётся вложением с запретом кеширования: файл содержит всё, что мы
 * знаем о человеке, и оседать в промежуточных кешах ему нельзя.
 */
export async function exportar(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const data = await buildExport(userId);
  if (!data) return next();

  const stamp = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="resolve-brasil-meus-dados-${stamp}.json"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(JSON.stringify(data, null, 2));
}

const requestSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
  confirmacao: z.string(),
});

const CONFIRMATION = "EXCLUIR";

export async function solicitarExclusao(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const parsed = requestSchema.safeParse(req.body ?? {});
  const target = "/minha-conta/privacidade";

  // Подтверждение словом, а не галочкой: удаление необратимо, и случайное
  // нажатие здесь стоит человеку всего дела.
  if (!parsed.success || parsed.data.confirmacao.trim().toUpperCase() !== CONFIRMATION) {
    res.redirect(
      303,
      `${target}?aviso=${encodeURIComponent(
        `Para confirmar, escreva ${CONFIRMATION} no campo indicado.`,
      )}`,
    );
    return;
  }

  const result = await requestDeletion({
    userId,
    reason: parsed.data.motivo?.trim() || null,
    ipPrefix: ipPrefix(req.ip) ?? null,
  });

  if (!result.ok) {
    res.redirect(
      303,
      `${target}?aviso=${encodeURIComponent("Já existe um pedido de exclusão em andamento.")}`,
    );
    return;
  }

  res.redirect(303, target);
}

export async function cancelarExclusao(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  await cancelDeletion(userId);
  res.redirect(303, "/minha-conta/privacidade");
}

export { CONFIRMATION };
