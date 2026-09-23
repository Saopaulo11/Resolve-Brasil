import type { CaseStatus, EscalationLevel } from "../generated/prisma/enums";

/**
 * Статусы дела в интерфейсе (§19).
 *
 * Подписи и пояснения живут рядом: без пояснения «Aguardando usuário» не
 * говорит человеку, что ход за ним, и дело зависает именно на этом шаге.
 */
export type StatusDefinition = {
  value: CaseStatus;
  label: string;
  hint: string;
  /** Ход за пользователем — такие дела поднимаются в списке выше. */
  needsUser: boolean;
  tone: "neutro" | "andamento" | "atencao" | "concluido";
};

export const STATUSES: readonly StatusDefinition[] = [
  {
    value: "NOVO",
    label: "Novo",
    hint: "Caso registrado. Ainda não começamos a organizar as informações.",
    needsUser: false,
    tone: "neutro",
  },
  {
    value: "EM_ANALISE",
    label: "Em análise",
    hint: "Estamos organizando as informações do caso.",
    needsUser: false,
    tone: "andamento",
  },
  {
    value: "AGUARDANDO_USUARIO",
    label: "Aguardando você",
    hint: "Falta uma informação ou um documento seu para seguir.",
    needsUser: true,
    tone: "atencao",
  },
  {
    value: "AGUARDANDO_EMPRESA",
    label: "Aguardando a empresa",
    hint: "A empresa foi contatada e o prazo de resposta está correndo.",
    needsUser: false,
    tone: "andamento",
  },
  {
    value: "RESPOSTA_RECEBIDA",
    label: "Resposta recebida",
    hint: "A empresa respondeu. Vale conferir o que ficou sem resposta.",
    needsUser: true,
    tone: "atencao",
  },
  {
    value: "PRECISA_DE_ACAO",
    label: "Precisa de ação",
    hint: "Há um próximo passo esperando por você.",
    needsUser: true,
    tone: "atencao",
  },
  {
    value: "ESCALADO",
    label: "Escalado",
    hint: "O caso foi levado a um canal acima da empresa.",
    needsUser: false,
    tone: "andamento",
  },
  {
    value: "RESOLVIDO",
    label: "Resolvido",
    hint: "O problema foi resolvido.",
    needsUser: false,
    tone: "concluido",
  },
  {
    value: "ENCERRADO",
    label: "Encerrado",
    hint: "O caso foi encerrado sem solução ou a pedido seu.",
    needsUser: false,
    tone: "concluido",
  },
];

const BY_VALUE = new Map(STATUSES.map((status) => [status.value, status]));

export function statusDefinition(value: CaseStatus): StatusDefinition {
  const found = BY_VALUE.get(value);
  if (!found) {
    // Невозможно при совпадающих enum, но молчаливый undefined в шаблоне
    // выглядел бы как пустой статус — лучше явная ошибка.
    throw new Error(`Статус без описания: ${value}`);
  }
  return found;
}

/** Каналы эскалации (§33). Порядок не универсален — его выбирает AI под случай. */
export const ESCALATION_LABELS: Record<EscalationLevel, string> = {
  NENHUM: "Sem escalonamento",
  EMPRESA: "Empresa",
  SAC: "SAC",
  OUVIDORIA: "Ouvidoria",
  CONSUMIDOR_GOV: "Consumidor.gov.br",
  ORGAO_COMPETENTE: "Órgão competente",
};

/** Форматирование суммы для интерфейса: R$ 349,90. */
export function formatBRL(amount: string | null): string | null {
  if (!amount) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
