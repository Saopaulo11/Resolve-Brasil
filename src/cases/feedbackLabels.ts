import type { FeedbackReason } from "../generated/prisma/enums";

/**
 * Причины отрицательной оценки (§52).
 *
 * Лежат отдельно от контроллеров: их читает и форма пользователя, и раздел
 * админки. Импорт одного контроллера из другого ради подписи связал бы
 * пользовательскую часть со служебной без всякой надобности.
 */
export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  "INFORMACAO_INCORRETA",
  "NAO_ENTENDI",
  "NAO_RESOLVEU",
  "FONTE_NAO_AJUDOU",
  "OUTRO",
];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  INFORMACAO_INCORRETA: "Informação incorreta",
  NAO_ENTENDI: "Não entendi",
  NAO_RESOLVEU: "Não resolveu meu problema",
  FONTE_NAO_AJUDOU: "Fonte não ajudou",
  OUTRO: "Outro",
};
