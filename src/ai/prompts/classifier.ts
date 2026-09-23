import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

/** §43: версия промпта растёт при каждом изменении текста. */
export const CASE_CLASSIFIER_PROMPT_VERSION = "1";

export function buildClassifierPrompt(context: PromptCaseContext) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: classificar o caso do consumidor.

Escolha a categoria que melhor descreve a situação. Se nenhuma se encaixar, use OUTRO — não force uma categoria próxima.

confidence é a sua confiança real na classificação, de 0 a 1. Baixa confiança é uma resposta legítima: uma classificação errada com confiança alta leva o caso pelo caminho errado.

missing_information: o que falta saber para seguir com segurança.
recommended_questions: perguntas que realmente mudam o próximo passo. Não peça dados pessoais que não sejam necessários.
risk_flags: sinais de atenção, como suspeita de fraude, valores altos ou prazos vencidos. Não invente riscos.

${LENGTH_HINTS}`,
    input: renderCaseContext(context),
  };
}
