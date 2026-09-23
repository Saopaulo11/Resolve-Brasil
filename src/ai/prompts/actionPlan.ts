import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

export const ACTION_PLAN_PROMPT_VERSION = "1";

export function buildActionPlanPrompt(
  context: PromptCaseContext,
  officialSources: Array<{ organization: string; title: string; url: string }>,
) {
  const sources =
    officialSources.length > 0
      ? officialSources
          .map((source) => `- ${source.organization} — ${source.title} — ${source.url}`)
          .join("\n")
      : "- nenhuma fonte oficial foi fornecida para este caso";

  return {
    instructions: `${SYSTEM_RULES}

TAREFA: montar o plano de ação para este caso.

Regras:
- Cada passo deve ser uma ação concreta que o usuário consegue executar.
- A ordem Empresa → SAC → Ouvidoria → Consumidor.gov.br → Procon NÃO é universal. Escolha o caminho adequado a este caso e explique o porquê no detalhe do passo.
- Em "source" de cada passo: use OFFICIAL_SOURCE apenas se o passo estiver apoiado em uma das fontes listadas abaixo; caso contrário use AI_SUGGESTION.
- Em "sources", liste apenas fontes da lista fornecida. NUNCA escreva uma URL que não esteja nela.
- Se nenhuma fonte foi fornecida, deixe "sources" vazio e registre em "uncertainties" que não foi possível confirmar o procedimento em fonte oficial.
- Em "uncertainties", diga o que depende de informação que ainda não temos.
- Não prometa resultado. Não afirme prazos legais como certos sem fonte.

FONTES OFICIAIS DISPONÍVEIS:
${sources}

${LENGTH_HINTS}`,
    input: renderCaseContext(context),
  };
}
