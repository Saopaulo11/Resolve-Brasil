import multer from "multer";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { loadConfig } from "../config/env";

/**
 * Разбор multipart-формы (§23).
 *
 * Ставится ДО проверки CSRF намеренно. CSRF читает поле из тела запроса, а
 * у multipart тело до разбора пустое — при обратном порядке любая загрузка
 * отвергалась бы как подделка. Так защита остаётся единой для всех
 * маршрутов, а не выборочной.
 *
 * Хранение в памяти: файл нужно проверить по сигнатуре и посчитать хеш до
 * того, как он окажется на диске. Размер ограничен конфигурацией, поэтому
 * память не разъезжается.
 */
const FIELD = "arquivo";

/** Файл, разобранный из формы. Содержимое держится в памяти, не на диске. */
export type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/**
 * Файлы текущего запроса — всегда массивом, даже когда он пуст.
 *
 * Обращаться к req.files напрямую не стоит: multer кладёт туда то массив,
 * то объект по полям, и каждый потребитель начинает проверять это сам.
 */
export function uploadedFiles(req: Request): UploadedFile[] {
  const files = (req as Request & { files?: unknown }).files;
  return Array.isArray(files) ? (files as UploadedFile[]) : [];
}

export function uploadParser(): RequestHandler {
  const config = loadConfig();
  const maxFiles = config.storage.maxFilesPerUpload;

  const parser = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.storage.maxFileSizeBytes,
      files: maxFiles,
      // Поля формы у нас короткие: токен, тип документа, решение по факту.
      fieldSize: 8 * 1024,
      fields: 20,
    },
  }).array(FIELD, maxFiles);

  return function parseUpload(req: Request, res: Response, next: NextFunction) {
    // Не multipart — разбирать нечего.
    if (!req.is("multipart/form-data")) return next();

    parser(req, res, (error: unknown) => {
      if (!error) return next();

      // Ошибки multer превращаем в понятный отказ: 500 на слишком большом
      // файле выглядел бы как поломка сервиса.
      if (error instanceof multer.MulterError) {
        res.status(413);
        return next(new Error("UPLOAD_REJEITADO"));
      }

      return next(error);
    });
  };
}

export { FIELD as UPLOAD_FIELD };
