import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

export const SUMMARY_PROMPT_VERSION = "1";

export function buildSummaryPrompt(context: PromptCaseContext) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: resumir o caso em poucas linhas.

Regras:
- O resumo serve para a pessoa retomar o caso depois de semanas: diga o que aconteceu, onde está e o que falta.
- "open_points": o que ainda está em aberto, sem inventar pendências.
- Não repita o relato inteiro. Resuma.

${LENGTH_HINTS}`,
    input: renderCaseContext(context),
  };
}
