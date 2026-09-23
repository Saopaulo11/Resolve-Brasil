import { describe, expect, it } from "vitest";
import { z } from "zod";

import { jsonSchemaFormat, toStrictJsonSchema } from "../../src/ai/openai/jsonSchema";
import { caseClassificationSchema, draftSchema } from "../../src/ai/schemas";

describe("схема для structured outputs", () => {
  it("запрещает лишние поля на каждом уровне", () => {
    // Без additionalProperties: false модель вправе дописать своё поле,
    // и строгий режим перестаёт быть строгим.
    const schema = toStrictJsonSchema(caseClassificationSchema);
    expect(schema.additionalProperties).toBe(false);
  });

  it("требует все поля", () => {
    const schema = toStrictJsonSchema(caseClassificationSchema) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it("убирает ограничения, оставляя форму", () => {
    // Пределы проверяет наша валидация после ответа (§8). В схеме для
    // модели их нет намеренно: набор принимаемых ключевых слов менялся,
    // и неподдержанное слово — это 400 на каждом запросе.
    const json = JSON.stringify(toStrictJsonSchema(draftSchema));

    for (const keyword of ["maxLength", "minLength", "maxItems", "minimum", "maximum"]) {
      expect(json, keyword).not.toContain(keyword);
    }

    // Форма при этом сохранена целиком.
    const schema = toStrictJsonSchema(draftSchema) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "body",
      "facts_used",
      "subject",
      "warnings",
    ]);
  });

  it("чистит вложенные уровни, а не только верхний", () => {
    const nested = z
      .object({
        items: z.array(z.object({ text: z.string().max(10) }).strict()).max(3),
      })
      .strict();

    const json = JSON.stringify(toStrictJsonSchema(nested));
    expect(json).not.toContain("maxLength");
    expect(json).not.toContain("maxItems");
    expect(json).toContain("\"text\"");
  });

  it("сохраняет перечисления — они задают форму, а не предел", () => {
    const json = JSON.stringify(toStrictJsonSchema(caseClassificationSchema));
    expect(json).toContain("PRODUTO_NAO_RECEBIDO");
    expect(json).toContain("OUTRO");
  });

  it("сохраняет допустимость null", () => {
    const schema = toStrictJsonSchema(caseClassificationSchema) as {
      properties: { subcategory: { anyOf?: Array<{ type?: string }> } };
    };
    const types = schema.properties.subcategory.anyOf?.map((item) => item.type) ?? [];
    expect(types).toContain("null");
  });

  it("собирает параметр формата целиком", () => {
    const format = jsonSchemaFormat("case_classification", caseClassificationSchema);
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("case_classification");
    expect(format.strict).toBe(true);
    expect(format.schema).toHaveProperty("properties");
  });
});
