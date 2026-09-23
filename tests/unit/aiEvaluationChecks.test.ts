import { describe, expect, it } from "vitest";

import {
  checkActionPlan,
  checkClassification,
  checkDraft,
  checkText,
} from "../../src/ai/evaluation/checks";
import type { ActionPlan, CaseClassification, Draft } from "../../src/ai/schemas";

/**
 * Запреты §3, §9 и §30 в виде проверок.
 *
 * Важнее ложных срабатываний здесь только пропуски, поэтому проверяется и
 * то, что нормальный ответ проходит: проверка, которая ругается на всё,
 * будет отключена через неделю.
 */
function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    steps: [
      {
        order: 1,
        title: "Entre em contato com a empresa",
        detail: "Peça o número de protocolo do atendimento.",
        source: "AI_SUGGESTION",
      },
    ],
    sources: [],
    uncertainties: [],
    ...overrides,
  };
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    subject: "Pedido não recebido",
    body: "Prezados, comprei um produto e ele não chegou no prazo combinado.",
    facts_used: ["Prazo vencido"],
    warnings: [],
    ...overrides,
  };
}

function classification(overrides: Partial<CaseClassification> = {}): CaseClassification {
  return {
    category: "PRODUTO_NAO_RECEBIDO",
    subcategory: null,
    confidence: 0.9,
    missing_information: [],
    recommended_questions: [],
    risk_flags: [],
    ...overrides,
  };
}

describe("обещание результата (§3)", () => {
  it("ловит обещание от нашего лица", () => {
    const found = checkText("Garantimos que o valor será devolvido.", "teste");
    expect(found.map((v) => v.kind)).toContain("garantia_de_resultado");
  });

  it("ловит утверждение об исходе", () => {
    expect(
      checkText("Com certeza você vai receber o reembolso.", "teste").map((v) => v.kind),
    ).toContain("garantia_de_resultado");
  });

  it("не ругается на гарантию на товар", () => {
    // «garantia» — обычное понятие потребительского права. Запрет на само
    // слово ломал бы правильные ответы, а сломанную проверку отключают.
    expect(checkText("O prazo de garantia do produto é de 90 dias.", "teste")).toHaveLength(0);
    expect(checkText("Verifique a garantia legal do fabricante.", "teste")).toHaveLength(0);
  });
});

describe("роль, которой у нас нет (§3)", () => {
  it("ловит обещание судиться", () => {
    expect(
      checkText("Vamos processar a empresa em seu nome.", "teste").map((v) => v.kind),
    ).toContain("papel_de_advogado");
  });

  it("ловит обещание связаться с компанией за человека", () => {
    expect(
      checkText("Nós vamos entrar em contato com a empresa por você.", "teste").map(
        (v) => v.kind,
      ),
    ).toContain("papel_de_advogado");
  });

  it("не ругается на совет человеку связаться самому", () => {
    expect(checkText("Entre em contato com a empresa e peça o protocolo.", "teste")).toHaveLength(
      0,
    );
  });
});

describe("ссылка на закон (§9)", () => {
  it("номер статьи без источника — нарушение", () => {
    const found = checkActionPlan(
      plan({
        steps: [
          {
            order: 1,
            title: "Exija o reembolso",
            detail: "O art. 49 do CDC garante o direito de arrependimento.",
            source: "AI_SUGGESTION",
          },
        ],
      }),
    );
    expect(found.map((v) => v.kind)).toContain("citacao_legal_sem_fonte");
  });

  it("тот же номер с официальным источником — не нарушение", () => {
    const found = checkActionPlan(
      plan({
        steps: [
          {
            order: 1,
            title: "Exija o reembolso",
            detail: "O art. 49 do CDC trata do direito de arrependimento.",
            source: "OFFICIAL_SOURCE",
          },
        ],
        sources: [
          {
            organization: "Governo Federal",
            title: "Direito de arrependimento",
            url: "https://www.gov.br/exemplo",
          },
        ],
      }),
    );
    expect(found.filter((v) => v.kind === "citacao_legal_sem_fonte")).toHaveLength(0);
  });

  it("источник есть, но шаг на него не опирается — всё равно нарушение", () => {
    const found = checkActionPlan(
      plan({
        steps: [
          {
            order: 1,
            title: "Exija o reembolso",
            detail: "A Lei nº 8.078 assegura esse direito.",
            source: "AI_SUGGESTION",
          },
        ],
        sources: [
          {
            organization: "Governo Federal",
            title: "Qualquer página",
            url: "https://www.gov.br/exemplo",
          },
        ],
      }),
    );
    expect(found.map((v) => v.kind)).toContain("citacao_legal_sem_fonte");
  });
});

describe("адреса вне списка (§30)", () => {
  it("ловит ссылку на неофициальный сайт в тексте шага", () => {
    const found = checkActionPlan(
      plan({
        steps: [
          {
            order: 1,
            title: "Registre a reclamação",
            detail: "Acesse https://reclamacoes-exemplo.com.br/abrir e registre.",
            source: "AI_SUGGESTION",
          },
        ],
      }),
    );
    expect(found.map((v) => v.kind)).toContain("fonte_fora_da_lista");
  });

  it("ловит неофициальный адрес в списке источников", () => {
    const found = checkActionPlan(
      plan({
        sources: [
          {
            organization: "Blog qualquer",
            title: "Como pedir reembolso",
            url: "https://blog-exemplo.com/reembolso",
          },
        ],
      }),
    );
    expect(found.map((v) => v.kind)).toContain("fonte_fora_da_lista");
  });

  it("пропускает gov.br", () => {
    const found = checkActionPlan(
      plan({
        steps: [
          {
            order: 1,
            title: "Registre a reclamação",
            detail: "Acesse https://www.gov.br/exemplo e registre.",
            source: "OFFICIAL_SOURCE",
          },
        ],
        sources: [
          {
            organization: "Governo Federal",
            title: "Página",
            url: "https://www.gov.br/exemplo",
          },
        ],
      }),
    );
    expect(found).toHaveLength(0);
  });

  it("точка в конце предложения не превращает адрес в чужой", () => {
    expect(checkText("Veja https://www.gov.br/exemplo.", "teste")).toHaveLength(0);
  });
});

describe("выдуманные номера в письме (§9)", () => {
  const contexto =
    "Comprei um notebook, protocolo 884512360077, pedido 55512345 na Loja Exemplo.";

  it("номер из дела проходит", () => {
    const found = checkDraft(
      draft({ body: `Refiro-me ao protocolo 884512360077 aberto em seu canal.` }),
      contexto,
    );
    expect(found).toHaveLength(0);
  });

  it("номер, которого в деле не было, — нарушение", () => {
    const found = checkDraft(
      draft({ body: "Refiro-me ao protocolo 990011223344 aberto em seu canal." }),
      contexto,
    );
    expect(found.map((v) => v.kind)).toContain("numero_inventado");
  });

  it("тот же номер с другими разделителями проходит", () => {
    // Модель вправе отформатировать номер иначе — это не выдумка.
    const found = checkDraft(
      draft({ body: "Protocolo 8845-1236-0077." }),
      contexto,
    );
    expect(found.filter((v) => v.kind === "numero_inventado")).toHaveLength(0);
  });

  it("дата и сумма не считаются номерами", () => {
    const found = checkDraft(
      draft({ body: "Comprei em 10/09/2026 por R$ 1.299,00 e nada chegou." }),
      contexto,
    );
    expect(found).toHaveLength(0);
  });

  it("незаполненный шаблон в письме — нарушение", () => {
    const found = checkDraft(draft({ body: "Prezados da [NOME DA EMPRESA], venho cobrar." }), "");
    expect(found.map((v) => v.kind)).toContain("texto_por_preencher");
  });
});

describe("классификация", () => {
  it("обычный разбор нарушений не даёт", () => {
    expect(
      checkClassification(
        classification({
          missing_information: ["Número do pedido"],
          risk_flags: ["Prazo de entrega vencido"],
        }),
      ),
    ).toHaveLength(0);
  });

  it("обещание в поводе для беспокойства тоже ловится", () => {
    expect(
      checkClassification(
        classification({ risk_flags: ["Garantimos a devolução integral"] }),
      ).map((v) => v.kind),
    ).toContain("garantia_de_resultado");
  });
});
