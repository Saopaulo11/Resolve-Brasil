import path from "node:path";

import type { NextFunction, Request, Response } from "express";

import { AI_DISCLAIMER_PT_BR } from "../ai/disclaimer";

/**
 * Рендеринг страницы в общий макет.
 *
 * Express рендерит одно представление, а нам нужен макет вокруг страницы:
 * сначала страница в строку, затем макет с этой строкой в body. Так макет
 * остаётся одним файлом и не дублируется в каждом шаблоне.
 */
export const VIEWS_ROOT = path.resolve(__dirname, "../../views");

export type PageLocals = Record<string, unknown> & {
  title: string;
  description: string;
};

export function renderPage(
  req: Request,
  res: Response,
  view: string,
  locals: PageLocals,
  next?: NextFunction,
): void {
  const base = {
    // Умолчания идут первыми: шаблоны обращаются к values и errors всегда,
    // но страница с формой обязана иметь возможность их переопределить.
    values: {} as Record<string, unknown>,
    errors: {} as Record<string, string>,
    ...locals,
    currentPath: req.path,
    csrfToken: req.csrfToken ?? "",
    aiDisclaimer: AI_DISCLAIMER_PT_BR,
  };

  const fail = next ?? req.next;

  res.render(path.join("pages", view), base, (error, html) => {
    if (error) {
      fail?.(error);
      return;
    }
    res.render(path.join("layouts", "base"), { ...base, body: html }, (layoutError, page) => {
      if (layoutError) {
        fail?.(layoutError);
        return;
      }
      res.send(page);
    });
  });
}
