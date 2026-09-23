/**
 * Федеративные единицы Бразилии (§57).
 *
 * Нужны не для красоты формы: Procon у каждого штата свой, и «куда идти»
 * без штата ответить нельзя. Список закрытый — введённый руками код даёт
 * штат, которого нет, и дело уходит в несуществующий канал.
 *
 * Спрашивается только штат. Города нет и не будет: город вместе с суммой,
 * категорией и месяцем опознаёт человека не хуже имени (§55), а для выбора
 * канала он не нужен.
 */
export type BrazilianState = {
  uf: string;
  name: string;
};

export const BRAZILIAN_STATES: readonly BrazilianState[] = [
  { uf: "AC", name: "Acre" },
  { uf: "AL", name: "Alagoas" },
  { uf: "AP", name: "Amapá" },
  { uf: "AM", name: "Amazonas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "DF", name: "Distrito Federal" },
  { uf: "ES", name: "Espírito Santo" },
  { uf: "GO", name: "Goiás" },
  { uf: "MA", name: "Maranhão" },
  { uf: "MT", name: "Mato Grosso" },
  { uf: "MS", name: "Mato Grosso do Sul" },
  { uf: "MG", name: "Minas Gerais" },
  { uf: "PA", name: "Pará" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PR", name: "Paraná" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RJ", name: "Rio de Janeiro" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "RS", name: "Rio Grande do Sul" },
  { uf: "RO", name: "Rondônia" },
  { uf: "RR", name: "Roraima" },
  { uf: "SC", name: "Santa Catarina" },
  { uf: "SP", name: "São Paulo" },
  { uf: "SE", name: "Sergipe" },
  { uf: "TO", name: "Tocantins" },
];

const BY_UF = new Map(BRAZILIAN_STATES.map((state) => [state.uf, state]));

export function isBrazilianState(value: unknown): value is string {
  return typeof value === "string" && BY_UF.has(value);
}

export function stateName(uf: string | null): string | null {
  return uf ? (BY_UF.get(uf)?.name ?? null) : null;
}
