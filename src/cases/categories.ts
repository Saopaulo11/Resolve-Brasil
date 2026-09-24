import type { CaseCategory } from "../generated/prisma/enums";

/**
 * Категории MVP (§11, §13).
 *
 * Один список на всё приложение: быстрые кнопки на главной, страница
 * категорий, разбор ответа классификатора и аналитика. Если держать их
 * в разных местах, ярлык в интерфейсе рано или поздно разъедется со
 * значением в базе.
 *
 * Расширение до telecom, banking, INSS и прочего (§11) делается добавлением
 * значения в enum и строки сюда — переписывать логику не нужно. Pix так и
 * добавлен: значение в enum, миграция, строка здесь.
 */
export type CategoryDefinition = {
  value: CaseCategory;
  /** Часть URL: /categorias/<slug>. Только латиница и дефисы. */
  slug: string;
  /** Подпись в интерфейсе, pt-BR. */
  label: string;
  /** Короткая формулировка от первого лица для быстрых кнопок (§13). */
  quickLabel: string;
  /**
   * Самая короткая подпись — для чипсов под полем ввода.
   *
   * Отдельно от quickLabel намеренно: там фраза от первого лица («Quero meu
   * dinheiro de volta»), и восемь таких в ряд занимают три строки и спорят
   * с полем за внимание. Здесь нужно только название ситуации.
   */
  chipLabel: string;
  icon: string;
  description: string;
};

export const CATEGORIES: readonly CategoryDefinition[] = [
  {
    value: "REEMBOLSO_NAO_RECEBIDO",
    slug: "reembolso-nao-recebido",
    label: "Reembolso não recebido",
    quickLabel: "Quero meu dinheiro de volta",
    chipLabel: "Dinheiro de volta",
    icon: "💰",
    description:
      "O cancelamento foi aceito ou a devolução foi combinada, mas o valor não voltou.",
  },
  {
    value: "PRODUTO_NAO_RECEBIDO",
    slug: "produto-nao-recebido",
    label: "Produto não recebido",
    quickLabel: "Meu produto não chegou",
    chipLabel: "Produto não chegou",
    icon: "📦",
    description: "A compra foi paga, o prazo passou e o produto não chegou.",
  },
  {
    value: "COBRANCA_INDEVIDA",
    slug: "cobranca-indevida",
    label: "Cobrança indevida",
    quickLabel: "Fui cobrado indevidamente",
    chipLabel: "Cobrança indevida",
    icon: "💳",
    description:
      "Apareceu uma cobrança que você não reconhece, em duplicidade ou fora do combinado.",
  },
  {
    value: "CANCELAMENTO_NAO_REALIZADO",
    slug: "cancelamento-nao-realizado",
    label: "Cancelamento não realizado",
    quickLabel: "Quero cancelar",
    chipLabel: "Cancelamento",
    icon: "❌",
    description: "Você pediu o cancelamento e ele não foi feito.",
  },
  {
    value: "PRODUTO_COM_DEFEITO",
    slug: "produto-com-defeito",
    label: "Produto com defeito",
    quickLabel: "Produto com defeito",
    chipLabel: "Produto com defeito",
    icon: "🔧",
    description: "O produto chegou com defeito, incompleto ou diferente do anunciado.",
  },
  {
    value: "SERVICO_NAO_PRESTADO",
    slug: "servico-nao-prestado",
    label: "Serviço não prestado",
    quickLabel: "Serviço não foi realizado",
    chipLabel: "Serviço não realizado",
    icon: "📝",
    description: "O serviço foi contratado e pago, mas não foi executado.",
  },
  {
    value: "PROBLEMA_COM_PIX",
    slug: "problema-com-pix",
    label: "Problema com Pix",
    quickLabel: "Tive um problema com Pix",
    chipLabel: "Problema com Pix",
    icon: "⚡",
    description:
      "O Pix saiu da conta e o problema é com ele: golpe, valor não reconhecido, " +
      "destinatário errado ou pagamento a uma empresa que não entregou.",
  },
  {
    value: "OUTRO",
    slug: "outro",
    label: "Outro problema",
    quickLabel: "Outro problema",
    chipLabel: "Outro",
    icon: "❓",
    description: "Sua situação não se encaixa nas anteriores.",
  },
];

export function findCategoryBySlug(slug: string): CategoryDefinition | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

export function findCategoryByValue(value: CaseCategory): CategoryDefinition | undefined {
  return CATEGORIES.find((category) => category.value === value);
}
