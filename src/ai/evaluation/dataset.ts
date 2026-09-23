import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

import { caseCategorySchema } from "../schemas";

/**
 * Набор для оценки качества модели (§81, §82).
 *
 * Все дела здесь выдуманы, и это не оговорка в комментарии, а условие
 * загрузки: каждое дело обязано нести флаг synthetic, а название компании —
 * слово «Exemplo». Выдуманная жалоба на настоящую компанию — это не тестовые
 * данные, а клевета, и однажды она попадает в отчёт как факт.
 *
 * Эти записи не идут ни в базу, ни в аналитику, ни в один показатель,
 * который показывается как результат продукта.
 */
const MARKER = "Exemplo";

const evalCaseSchema = z
  .object({
    id: z.string().min(1).max(60),
    synthetic: z.literal(true),
    description: z.string().min(20).max(5000),
    companyName: z.string().min(1).max(200),
    amount: z.string().nullable(),
    paymentMethod: z.string().nullable(),
    expectedCategory: caseCategorySchema,
    note: z.string().max(500),
  })
  .strict()
  .refine((item) => item.companyName.includes(MARKER), {
    message: `Название компании обязано содержать «${MARKER}»: выдуманная жалоба на настоящую компанию — клевета (§82).`,
    path: ["companyName"],
  });

const datasetSchema = z
  .object({
    _aviso: z.string().min(1),
    version: z.number().int().positive(),
    cases: z.array(evalCaseSchema).min(1),
  })
  .strict();

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalDataset = z.infer<typeof datasetSchema>;

export const DEFAULT_DATASET_PATH = resolve(process.cwd(), "evals/dataset.json");

export function parseDataset(raw: unknown): EvalDataset {
  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      `Набор для оценки не прошёл проверку: ${first?.path.join(".")} — ${first?.message}`,
    );
  }

  const ids = new Set<string>();
  for (const item of parsed.data.cases) {
    if (ids.has(item.id)) throw new Error(`Повторяющийся идентификатор дела: ${item.id}`);
    ids.add(item.id);
  }

  return parsed.data;
}

export function loadDataset(path: string = DEFAULT_DATASET_PATH): EvalDataset {
  return parseDataset(JSON.parse(readFileSync(path, "utf8")));
}

export { MARKER as SYNTHETIC_MARKER };
