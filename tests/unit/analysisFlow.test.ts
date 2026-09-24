import { describe, expect, it } from "vitest";

import {
  analysisProgress,
  ANALYSIS_ORDER,
  STEP_LABEL,
} from "../../src/cases/analysisFlow";

/**
 * Порядок разбора дела (§3).
 *
 * Главная обещает: IA понимает ситуацию, спрашивает недостающее и выдаёт
 * план с готовым сообщением. Порядок этих шагов и есть обещание.
 */
describe("ход разбора дела", () => {
  it("на пустом деле начинает с понимания ситуации", () => {
    const progresso = analysisProgress([]);

    expect(progresso.next).toBe("classificar");
    expect(progresso.done).toBe(0);
    expect(progresso.total).toBe(4);
    expect(progresso.label).toBe(STEP_LABEL.classificar);
  });

  it("идёт по шагам в обещанном порядке", () => {
    const feitos: string[] = [];
    const esperado = ["classificar", "perguntas", "plano", "rascunho"];

    // Каждый шаг закрывается своим сообщением и уступает место следующему.
    const tipos = ["CLASSIFICACAO", "PERGUNTAS", "PLANO_DE_ACAO", "RASCUNHO"];

    for (let i = 0; i < tipos.length; i += 1) {
      const progresso = analysisProgress(tipos.slice(0, i));
      feitos.push(String(progresso.next));
      expect(progresso.done).toBe(i);
    }

    expect(feitos).toEqual(esperado);
    expect(ANALYSIS_ORDER).toEqual(esperado);
  });

  it("на полном деле разбор закончен", () => {
    const progresso = analysisProgress([
      "CLASSIFICACAO",
      "PERGUNTAS",
      "PLANO_DE_ACAO",
      "RASCUNHO",
    ]);

    expect(progresso.next).toBeNull();
    expect(progresso.done).toBe(4);
    expect(progresso.label).toBeNull();
  });

  it("пропущенный шаг подхватывается, а не теряется", () => {
    // Шаг мог сорваться, а следующий человек запустил руками. Разбор
    // возвращается к пропущенному, а не считает дело разобранным.
    const progresso = analysisProgress(["CLASSIFICACAO", "PLANO_DE_ACAO"]);

    expect(progresso.next).toBe("perguntas");
    expect(progresso.done).toBe(2);
  });

  it("чужие сообщения в деле на счёт не влияют", () => {
    // В деле есть и переписка, и разбор ответа компании.
    const progresso = analysisProgress([
      "CLASSIFICACAO",
      "ANALISE_DE_RESPOSTA",
      "NOTA",
    ]);

    expect(progresso.next).toBe("perguntas");
    expect(progresso.done).toBe(1);
  });
});
