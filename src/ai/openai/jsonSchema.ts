import { z } from "zod";

/**
 * Схема структурированного вывода для OpenAI — из тех же схем zod (§44).
 *
 * Один источник правды: описание ответа живёт в src/ai/schemas.ts, отсюда оно
 * же уходит модели. Дублировать JSON Schema руками нельзя — две копии
 * разъедутся на первой же правке, и валидация начнёт отвергать то, что
 * модель сгенерировала по нашему же описанию.
 *
 * Ограничения (maxLength, minimum, maxItems и прочие) в схему для модели НЕ
 * попадают. Набор ключевых слов, который принимает строгий режим, со
 * временем менялся, и неподдержанное слово — это ошибка 400 на каждом
 * запросе. Форму ответа задаёт схема, а пределы всё равно проверяются
 * нашей валидацией уже после ответа (§8) — там они и обязаны проверяться.
 * Сами пределы модели сообщаются словами, в тексте запроса.
 */

/** Ключевые слова, которые описывают пределы, а не форму. */
const CONSTRAINT_KEYWORDS = new Set([
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "maximum",
  "minimum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "multipleOf",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
  "$schema",
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (CONSTRAINT_KEYWORDS.has(key)) continue;
    out[key] = strip(value);
  }
  return out;
}

export type StrictJsonSchema = Record<string, unknown>;

export function toStrictJsonSchema(schema: z.ZodType): StrictJsonSchema {
  const generated = z.toJSONSchema(schema, { io: "output" });
  return strip(generated) as StrictJsonSchema;
}

/**
 * Готовый параметр text.format для Responses API.
 *
 * strict: true обязателен — без него модель вправе вернуть что угодно, и
 * структурированный вывод перестаёт быть структурированным.
 */
export function jsonSchemaFormat(name: string, schema: z.ZodType) {
  return {
    type: "json_schema" as const,
    name,
    strict: true,
    schema: toStrictJsonSchema(schema),
  };
}

export { CONSTRAINT_KEYWORDS };
