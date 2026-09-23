import { LENGTH_HINTS, renderCaseContext, SYSTEM_RULES, type PromptCaseContext } from "./shared";

export const DRAFT_PROMPT_VERSION = "1";

export function buildDraftPrompt(context: PromptCaseContext) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: preparar a mensagem que o usuário enviará para a empresa.

Regras:
- Use SOMENTE fatos presentes no caso. Não invente número de pedido, protocolo, data, valor ou nome de atendente.
- Se um dado importante estiver faltando, deixe um marcador claro entre colchetes, por exemplo [número do pedido], e registre isso em "warnings".
- Em "facts_used", liste os fatos do caso que você de fato usou na mensagem. Se um fato não estiver nessa lista, ele não pode aparecer no texto.
- Tom: firme, educado e objetivo. Sem ameaça, sem ofensa, sem linguagem jurídica decorativa.
- Não afirme direitos como garantidos. Descreva o que aconteceu e o que se pede.
- A mensagem é escrita na primeira pessoa, como se o próprio usuário estivesse escrevendo.

${LENGTH_HINTS}`,
    input: renderCaseContext(context),
  };
}
