import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

export const QUESTIONS_PROMPT_VERSION = "1";

export function buildQuestionsPrompt(context: PromptCaseContext) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: formular as perguntas essenciais para avançar neste caso.

Regras:
- No máximo 5 perguntas. Menos é melhor: uma enxurrada de perguntas no primeiro contato afasta a pessoa.
- Pergunte apenas o que muda o próximo passo. Se a resposta não altera nada, não pergunte.
- Não peça CPF, endereço, dados bancários ou qualquer dado pessoal que não seja indispensável.
- Não repita o que o usuário já informou.
- Em "why", explique em uma frase por que essa resposta muda o encaminhamento.
- Marque required: true apenas quando sem a resposta não é possível seguir.

${LENGTH_HINTS}`,
    input: renderCaseContext(context),
  };
}
