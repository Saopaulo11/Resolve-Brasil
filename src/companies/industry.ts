import type { Industry } from "../generated/prisma/enums";
import { normalizeCompanyName } from "./normalize";

/**
 * Отрасль компании по её названию (§86).
 *
 * Здесь нет и не будет справочника настоящих компаний: «Magazine Luiza —
 * розница» это знание, которого у нас нет, а вписанное по памяти оно
 * становится выдумкой (§82). Работает только то, что компания сказала о
 * себе сама в собственном названии: «Banco …», «… Seguros», «… Telecom».
 *
 * Не сработало ни одно правило — OTHER. Это «не определено», а не
 * «прочее», и в отчётах так и читается.
 *
 * Вместе с отраслью возвращается слово, по которому она определена. Без
 * него ошибку правила невозможно заметить: отрасль выглядит одинаково
 * достоверно и когда угадана, и когда взята из названия.
 */
export type IndustryGuess = {
  industry: Industry;
  /** Слово из названия, давшее ответ. null — если ничего не сработало. */
  evidence: string | null;
};

/**
 * Правила по убыванию точности: «loja online» обязана дойти до ECOMMERCE
 * раньше, чем «loja» доведёт её до RETAIL.
 */
const RULES: ReadonlyArray<{ industry: Industry; markers: readonly string[] }> = [
  {
    industry: "ECOMMERCE",
    markers: ["ecommerce", "e commerce", "marketplace", "loja online", "loja virtual"],
  },
  {
    industry: "BANKING",
    markers: ["banco", "bank", "bancario", "bancaria"],
  },
  {
    industry: "FINTECH",
    markers: ["fintech", "pagamentos", "meios de pagamento", "carteira digital", "credito"],
  },
  {
    industry: "INSURANCE",
    markers: ["seguro", "seguros", "seguradora", "previdencia", "capitalizacao"],
  },
  {
    industry: "TELECOM",
    markers: [
      "telecom",
      "telecomunicacoes",
      "telefonia",
      "celular",
      "banda larga",
      "fibra",
      "provedor",
    ],
  },
  {
    industry: "TRAVEL",
    markers: [
      "viagens",
      "turismo",
      "aerea",
      "aereas",
      "airlines",
      "linhas aereas",
      "passagens",
      "hotel",
      "hoteis",
      "pousada",
    ],
  },
  {
    industry: "UTILITIES",
    markers: [
      "energia",
      "eletrica",
      "eletricidade",
      "saneamento",
      "esgoto",
      "distribuidora de gas",
      "companhia de agua",
    ],
  },
  {
    industry: "RETAIL",
    markers: ["loja", "lojas", "supermercado", "atacado", "varejo", "magazine", "farmacia"],
  },
  {
    industry: "SERVICES",
    markers: ["academia", "clinica", "escola", "faculdade", "oficina", "transportadora"],
  },
];

/** Маркер обязан быть отдельным словом: «banco» в «bancoexemplo» — не признак. */
function containsMarker(normalized: string, marker: string): boolean {
  const padded = ` ${normalized} `;
  return padded.includes(` ${marker} `);
}

export function detectIndustry(rawName: string): IndustryGuess {
  const normalized = normalizeCompanyName(rawName);
  if (normalized.length === 0) return { industry: "OTHER", evidence: null };

  for (const rule of RULES) {
    for (const marker of rule.markers) {
      if (containsMarker(normalized, marker)) {
        return { industry: rule.industry, evidence: marker };
      }
    }
  }

  return { industry: "OTHER", evidence: null };
}

export const INDUSTRY_LABELS: Record<Industry, string> = {
  ECOMMERCE: "Comércio eletrônico",
  TELECOM: "Telecomunicações",
  BANKING: "Bancos",
  FINTECH: "Serviços financeiros digitais",
  INSURANCE: "Seguros",
  TRAVEL: "Viagens e turismo",
  UTILITIES: "Serviços públicos",
  RETAIL: "Varejo",
  SERVICES: "Serviços",
  // §86: честное «не определено», а не корзина «прочее».
  OTHER: "Não identificado",
};

export { RULES as INDUSTRY_RULES };
