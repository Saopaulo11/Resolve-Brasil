/**
 * Общие правила для всех запросов к модели.
 *
 * Здесь собраны запреты, нарушение которых причиняет пользователю реальный
 * вред: выдуманный закон, выдуманный срок, обещание исхода, выданное за
 * право. Эти строки — не стилистика, а граница продукта (§3, §5, §9, §30).
 *
 * Текст для модели — на португальском: ответ идёт пользователю на pt-BR, и
 * инструкция на том же языке даёт заметно более устойчивый результат, чем
 * перевод правил на лету.
 */
export const SYSTEM_RULES = `Você é o assistente do Resolve Brasil, um serviço que ajuda consumidores brasileiros a entender problemas de consumo e organizar os próximos passos.

O QUE VOCÊ NÃO É
- Você não é advogado, escritório de advocacia, órgão público, banco ou instituição financeira.
- Você não representa o usuário perante empresas ou autoridades.
- Você não presta consultoria jurídica e não substitui um advogado.

O QUE VOCÊ NUNCA FAZ
- Nunca invente leis, artigos, procedimentos, prazos, valores, empresas, protocolos, números de pedido, datas, documentos, fontes, estatísticas, respostas de empresas ou casos de sucesso.
- Nunca afirme um desfecho jurídico como certo.
- Nunca use formulações como "você certamente vai ganhar", "a empresa certamente deve pagar" ou "você tem direito garantido a X".
- Nunca apresente suposição como fato confirmado.

COMO VOCÊ SE EXPRESSA
- Use "pode ser aplicável", "uma possibilidade é", "vale verificar", "segundo a fonte oficial", "com base nas informações fornecidas".
- Quando não for possível confirmar algo, escreva exatamente: "Não foi possível confirmar essa informação."
- Escreva em português do Brasil, em linguagem simples, como se explicasse para uma pessoa que não conhece o assunto.

TRÊS TIPOS DE INFORMAÇÃO QUE NÃO SE MISTURAM
- USER FACT: o que o usuário informou ou confirmou.
- OFFICIAL SOURCE: o que está confirmado por uma fonte oficial que foi fornecida a você.
- AI SUGGESTION: sua recomendação prática.
Nunca apresente uma AI SUGGESTION como se fosse OFFICIAL SOURCE.

DADOS
- Trabalhe apenas com as informações fornecidas nesta solicitação.
- Se faltar informação para responder com segurança, diga o que falta em vez de preencher a lacuna com suposição.
- Responda sempre no formato estruturado solicitado, sem texto fora dele.`;

/**
 * Пределы полей сообщаются словами: в схему для модели они не попадают
 * (см. openai/jsonSchema.ts), а проверяются нашей валидацией после ответа.
 */
export const LENGTH_HINTS = `LIMITES
- Textos curtos: no máximo algumas frases por campo.
- Listas: no máximo 10 itens, salvo indicação diferente.
- Não repita a mesma informação em campos diferentes.`;

/** Описание дела для модели — только разрешённая выборка (§47). */
export type PromptCaseContext = {
  publicId: string;
  description: string;
  category: string | null;
  subcategory: string | null;
  companyName: string | null;
  amount: string | null;
  currency: string;
  paymentMethod: string | null;
  pixSituation: string | null;
  state: string | null;
  purchaseDate: string | null;
  promisedDate: string | null;
  status: string;
  confirmedFacts: Array<{ field: string; value: string }>;
  timeline: Array<{ date: string; title: string }>;
};

/**
 * Дело в виде текста для модели.
 *
 * Пустые поля показываются явно как «não informado»: иначе модель склонна
 * заполнить пропуск правдоподобным значением, а именно этого делать нельзя.
 */
export function renderCaseContext(context: PromptCaseContext): string {
  const line = (label: string, value: string | null) =>
    `- ${label}: ${value && value.length > 0 ? value : "não informado"}`;

  const facts =
    context.confirmedFacts.length > 0
      ? context.confirmedFacts
          .map((fact) => `- ${fact.field}: ${fact.value}`)
          .join("\n")
      : "- nenhum fato confirmado ainda";

  const timeline =
    context.timeline.length > 0
      ? context.timeline.map((event) => `- ${event.date}: ${event.title}`).join("\n")
      : "- sem eventos registrados";

  return `CASO ${context.publicId}

RELATO DO USUÁRIO (USER FACT):
${context.description}

DADOS DO CASO:
${line("Categoria", context.category)}
${line("Subcategoria", context.subcategory)}
${line("Empresa", context.companyName)}
${line("Valor", context.amount ? `${context.amount} ${context.currency}` : null)}
${line("Forma de pagamento", context.paymentMethod)}
${line("Situação do Pix (informada pelo usuário)", context.pixSituation)}
${line("Estado (UF)", context.state)}
${line("Data da compra", context.purchaseDate)}
${line("Prazo prometido", context.promisedDate)}
${line("Status", context.status)}

FATOS CONFIRMADOS PELO USUÁRIO (USER FACT):
${facts}

LINHA DO TEMPO:
${timeline}`;
}
