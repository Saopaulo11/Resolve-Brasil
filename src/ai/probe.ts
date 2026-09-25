import type { CaseClassification } from "./schemas";
import type { AiResult, CaseContext } from "./providers/AIProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";

/**
 * Проба настоящего пути разбора (§41).
 *
 * Обычный запрос к провайдеру и разбор дела — разные пути, и первый может
 * проходить, когда второй отвергается. Причин тому несколько: модель может
 * не принять json_schema, схема может оказаться для неё неподходящей, ответ
 * может не влезть в лимит токенов или не пройти проверку zod. Проверка
 * «провайдер отвечает» не говорит ни о чём из этого.
 *
 * Поэтому проба идёт тем же кодом, что и настоящая классификация: тот же
 * промпт, та же схема (строгая, со всеми полями), тот же предел токенов,
 * та же проверка ответа. Мелкая схема вида {status: string} проверяла бы
 * только сам факт поддержки json_schema — а ломается обычно не он.
 *
 * Дело здесь выдуманное и постоянное: ничьи данные наружу не уходят, и
 * результат сравним между запусками.
 */
const CASO_DE_PROVA: CaseContext = {
  publicId: "RB-DIAGNO",
  description:
    "Comprei um produto pela internet, paguei via Pix e até hoje não recebi.",
  category: null,
  subcategory: null,
  companyName: null,
  amount: null,
  currency: "BRL",
  paymentMethod: "PIX",
  pixSituation: null,
  state: null,
  purchaseDate: null,
  promisedDate: null,
  status: "NOVO",
  confirmedFacts: [],
  timeline: [],
};

export async function probeClassification(): Promise<AiResult<CaseClassification>> {
  // Провайдер берётся напрямую, а не через aiProvider(): страница про
  // OpenAI и должна проверять OpenAI, независимо от AI_PROVIDER.
  return new OpenAIProvider().classifyCase(CASO_DE_PROVA);
}

export { CASO_DE_PROVA };
