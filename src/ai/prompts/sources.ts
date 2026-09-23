import { LENGTH_HINTS, SYSTEM_RULES } from "./shared";

export const SOURCES_PROMPT_VERSION = "1";

export function buildSourcesPrompt(
  query: string,
  category: string | null,
  candidates: Array<{ organization: string; title: string; url: string }>,
) {
  const list =
    candidates.length > 0
      ? candidates
          .map((item) => `- ${item.organization} — ${item.title} — ${item.url}`)
          .join("\n")
      : "- nenhuma fonte disponível";

  return {
    instructions: `${SYSTEM_RULES}

TAREFA: escolher, entre as fontes oficiais fornecidas, as que respondem à pergunta.

Regras CRÍTICAS:
- Você SÓ pode retornar URLs que estejam na lista abaixo, copiadas exatamente.
- Você NUNCA inventa uma URL, nem mesmo de um site oficial conhecido. Uma URL inventada de gov.br é o erro mais convincente e mais grave que você pode cometer.
- Se nenhuma fonte da lista responder à pergunta, retorne "sources" vazio e "not_found": true.
- "relevance" é o quanto a fonte responde à pergunta, de 0 a 1.

FONTES DISPONÍVEIS:
${list}

${LENGTH_HINTS}`,
    input: `PERGUNTA: ${query}
CATEGORIA DO CASO: ${category ?? "não classificada"}`,
  };
}
