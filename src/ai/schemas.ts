import { z } from "zod";

/**
 * Схемы структурированного вывода AI (§8, §44).
 *
 * Ответ модели не показывается пользователю напрямую: сначала он обязан
 * пройти здесь. Неизвестное поле или неверный тип — это ошибка обработки,
 * а не повод показать «как есть»: иначе галлюцинация доедет до интерфейса
 * и будет выглядеть как подтверждённый факт.
 */

export const caseCategorySchema = z.enum([
  "PRODUTO_NAO_RECEBIDO",
  "REEMBOLSO_NAO_RECEBIDO",
  "COBRANCA_INDEVIDA",
  "CANCELAMENTO_NAO_REALIZADO",
  "PRODUTO_COM_DEFEITO",
  "SERVICO_NAO_PRESTADO",
  "OUTRO",
]);

export const factSourceSchema = z.enum([
  "USER_FACT",
  "OFFICIAL_SOURCE",
  "AI_SUGGESTION",
]);

const confidence = z.number().min(0).max(1);

/** §27. */
export const caseClassificationSchema = z
  .object({
    category: caseCategorySchema,
    subcategory: z.string().max(120).nullable(),
    confidence,
    missing_information: z.array(z.string().max(300)).max(20),
    recommended_questions: z.array(z.string().max(300)).max(10),
    risk_flags: z.array(z.string().max(120)).max(20),
  })
  .strict();

/** §28. Вопросы, которые реально меняют дальнейший ход дела. */
export const questionsSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            id: z.string().max(60),
            question: z.string().max(300),
            why: z.string().max(300),
            required: z.boolean(),
          })
          .strict(),
      )
      // §20: не больше 3–5 вопросов за этап.
      .max(5),
  })
  .strict();

/** §33, §44. */
export const actionPlanSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            order: z.number().int().min(1).max(20),
            title: z.string().max(200),
            detail: z.string().max(1000),
            source: factSourceSchema,
          })
          .strict(),
      )
      .max(20),
    sources: z
      .array(
        z
          .object({
            organization: z.string().max(200),
            title: z.string().max(300),
            url: z.url(),
          })
          .strict(),
      )
      .max(10),
    uncertainties: z.array(z.string().max(300)).max(10),
  })
  .strict();

/** §34. facts_used не даёт модели вписать в письмо то, чего нет в деле. */
export const draftSchema = z
  .object({
    subject: z.string().max(200),
    body: z.string().max(8000),
    facts_used: z.array(z.string().max(300)).max(40),
    warnings: z.array(z.string().max(300)).max(10),
  })
  .strict();

/** §26. Каждое извлечённое поле приходит с уверенностью и остаётся неподтверждённым. */
export const documentExtractionSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            field: z.enum([
              "company",
              "amount",
              "purchase_date",
              "payment_method",
              "order_number",
              "promised_delivery_date",
              "refund_amount",
              "protocol",
            ]),
            value: z.string().max(500),
            confidence,
          })
          .strict(),
      )
      .max(30),
    notes: z.array(z.string().max(300)).max(10),
  })
  .strict();

/** §35. */
export const responseAnalysisSchema = z
  .object({
    what_company_said: z.string().max(2000),
    what_it_means: z.string().max(2000),
    what_is_missing: z.array(z.string().max(300)).max(15),
    possible_next_action: z.string().max(1000),
    suggested_reply: z.string().max(4000).nullable(),
  })
  .strict();

export const caseSummarySchema = z
  .object({
    summary: z.string().max(2000),
    open_points: z.array(z.string().max(300)).max(15),
  })
  .strict();

/** §29, §30. URL обязателен и обязан быть настоящим — выдумывать нельзя. */
export const sourceSearchSchema = z
  .object({
    sources: z
      .array(
        z
          .object({
            organization: z.string().max(200),
            title: z.string().max(300),
            url: z.url(),
            relevance: confidence,
          })
          .strict(),
      )
      .max(10),
    not_found: z.boolean(),
  })
  .strict();

export type CaseClassification = z.infer<typeof caseClassificationSchema>;
export type Questions = z.infer<typeof questionsSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;
export type ResponseAnalysis = z.infer<typeof responseAnalysisSchema>;
export type CaseSummary = z.infer<typeof caseSummarySchema>;
export type SourceSearch = z.infer<typeof sourceSearchSchema>;
