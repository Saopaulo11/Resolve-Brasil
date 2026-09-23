import { VIOLATION_LABELS } from "./checks";
import type { EvalReport } from "./runner";

/**
 * Текстовый отчёт о прогоне (§81).
 *
 * Доля без числа дел бесполезна, поэтому рядом всегда стоит, из скольких
 * она посчитана. Прочерк вместо доли — когда считать не из чего.
 */
function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push("=== Avaliação do modelo (§81) ===");
  lines.push("Conjunto sintético. Nenhum caso, empresa ou número aqui é real.");
  lines.push("");
  lines.push(`Provedor:  ${report.provider}${report.model ? ` (${report.model})` : ""}`);
  lines.push(`Início:    ${report.startedAt.toISOString()}`);
  lines.push(`Duração:   ${(report.durationMs / 1000).toFixed(1)} s`);
  lines.push("");

  lines.push(pad("Caso", 12) + pad("Esperado", 30) + pad("Obtido", 30) + "Confiança");
  for (const outcome of report.outcomes) {
    const mark = outcome.error !== null ? "!" : outcome.correct ? "ok" : "X";
    lines.push(
      pad(`${mark} ${outcome.id}`, 12) +
        pad(outcome.expected, 30) +
        pad(outcome.error !== null ? `erro: ${outcome.error}` : (outcome.actual ?? "—"), 30) +
        (outcome.confidence === null ? "—" : `${Math.round(outcome.confidence * 100)}%`),
    );
  }

  lines.push("");
  lines.push(`Casos:              ${report.total}`);
  lines.push(`Com resposta:       ${report.completed}`);
  lines.push(`Sem resposta:       ${report.failed}`);
  lines.push(`Categoria correta:  ${report.correct} de ${report.completed}`);
  lines.push(`Acerto:             ${percent(report.accuracy)}`);
  // Уверенная ошибка опаснее неуверенной: её никто не перепроверит.
  lines.push(`Errou com certeza:  ${report.confidentlyWrong}`);
  lines.push("");

  if (report.violations.length === 0) {
    lines.push("Proibições: nenhuma violação.");
  } else {
    lines.push(`Proibições: ${report.violations.length} violação(ões).`);
    for (const violation of report.violations) {
      lines.push(`  - ${VIOLATION_LABELS[violation.kind]} [${violation.where}]: «${violation.evidence}»`);
    }
  }

  return lines.join("\n");
}
