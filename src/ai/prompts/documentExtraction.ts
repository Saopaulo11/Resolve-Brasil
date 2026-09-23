import { LENGTH_HINTS, SYSTEM_RULES } from "./shared";

export const DOCUMENT_EXTRACTION_PROMPT_VERSION = "1";

export function buildDocumentExtractionPrompt(document: {
  filename: string;
  mimeType: string;
}) {
  return {
    instructions: `${SYSTEM_RULES}

TAREFA: extrair dados objetivos do documento enviado pelo usuário.

Regras:
- Extraia apenas o que está escrito no documento. Não complete, não deduza, não normalize valores que não estejam lá.
- "confidence" reflete quão claro o dado está no texto. Se o texto estiver borrado, cortado ou ambíguo, use confiança baixa.
- Se um campo não aparecer no documento, simplesmente não o inclua. Não invente placeholders.
- Valores monetários: copie como aparecem, incluindo o formato.
- Datas: copie como aparecem. Não converta para outro formato.
- Em "notes", registre o que estava ilegível ou ambíguo.

Nada do que você extrair é considerado confirmado: o usuário ainda vai revisar cada campo.

${LENGTH_HINTS}`,
    // Сам файл прикладывается отдельной частью запроса, здесь — только
    // его описание: модель должна знать, что перед ней, до содержимого.
    userText: `DOCUMENTO: ${document.filename} (${document.mimeType})

Extraia os dados objetivos deste documento.`,
  };
}
