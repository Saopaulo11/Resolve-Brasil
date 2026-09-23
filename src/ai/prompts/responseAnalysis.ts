import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

export const RESPONSE_ANALYSIS_PROMPT_VERSION = "1";

export function buildResponseAnalysisPrompt(
  context: PromptCaseContext,
  companyResponse: string,
) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: analisar a resposta que a empresa enviou ao usuário.

Regras:
- "what_company_said": resuma a resposta da empresa sem interpretar. É um fato do texto recebido.
- "what_it_means": explique em linguagem simples o que isso significa na prática. Isso é AI SUGGESTION.
- "what_is_missing": aponte o que o usuário perguntou e a empresa não respondeu, ou o que ficou vago (prazo sem data, valor sem número, promessa sem protocolo).
- "possible_next_action": um próximo passo possível, não uma garantia.
- "suggested_reply": rascunho de resposta usando apenas fatos do caso e da resposta recebida. Se não houver o que responder, use null.
- Não invente o que a empresa teria dito. Se o texto estiver truncado ou ilegível, diga isso em "what_is_missing".

${LENGTH_HINTS}`,
    input: `${renderCaseContext(context)}

RESPOSTA RECEBIDA DA EMPRESA (texto enviado pelo usuário):
${companyResponse}`,
  };
}
