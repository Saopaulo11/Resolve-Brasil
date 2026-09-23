import type { PixSituation } from "../generated/prisma/enums";

/**
 * Ситуация с Pix (§36, §84).
 *
 * Pix — основной способ оплаты в Бразилии, и разные беды с ним ведут в
 * совершенно разные стороны: мошенничество, платёж не тем, спор с реальной
 * компанией. Без различения всё это сваливается в одну кучу «не пришёл
 * товар», и подсказки получаются одинаковыми там, где они не могут быть
 * одинаковыми.
 *
 * Ситуацию выбирает человек, а не выводит система: отличить мошенничество
 * от коммерческого спора по рассказу нельзя, а ошибка здесь дорогая — она
 * уводит дело не туда. Поэтому это USER_FACT (§5).
 *
 * Конкретных процедур и сроков здесь нет намеренно. Они меняются и обязаны
 * приходить из проверенного официального источника (§9, §30, §32), а не из
 * строки в коде, которую никто не перечитывает.
 */
export type PixSituationDefinition = {
  value: PixSituation;
  label: string;
  hint: string;
};

export const PIX_SITUATIONS: readonly PixSituationDefinition[] = [
  {
    value: "PRODUTO_NAO_RECEBIDO",
    label: "Paguei a uma empresa e não recebi",
    hint: "A empresa existe e o Pix foi para ela, mas o produto ou serviço não veio.",
  },
  {
    value: "GOLPE_FRAUDE",
    label: "Foi um golpe",
    hint: "Quem recebeu se passou por outra pessoa, loja ou empresa.",
  },
  {
    value: "PIX_NAO_RECONHECIDO",
    label: "Não fui eu que fiz esse Pix",
    hint: "O valor saiu da minha conta sem que eu tenha feito a transferência.",
  },
  {
    value: "DESTINATARIO_ERRADO",
    label: "Enviei para a chave errada",
    hint: "O Pix foi feito por mim, mas para a pessoa ou chave errada.",
  },
  {
    value: "PROBLEMA_BANCARIO",
    label: "O problema foi no banco",
    hint: "Valor debitado duas vezes, Pix que não caiu, devolução que não chegou.",
  },
  {
    value: "DISPUTA_COMERCIAL",
    label: "Recebi, mas não era o combinado",
    hint: "O produto ou serviço chegou, e a discussão é sobre o que foi entregue.",
  },
];

const BY_VALUE = new Map(PIX_SITUATIONS.map((item) => [item.value, item]));

export function pixSituationDefinition(value: PixSituation): PixSituationDefinition {
  const found = BY_VALUE.get(value);
  if (!found) throw new Error(`Ситуация Pix без описания: ${value}`);
  return found;
}

export function isPixSituation(value: unknown): value is PixSituation {
  return typeof value === "string" && BY_VALUE.has(value as PixSituation);
}

export const PIX_SITUATION_LABELS: Record<PixSituation, string> = Object.fromEntries(
  PIX_SITUATIONS.map((item) => [item.value, item.label]),
) as Record<PixSituation, string>;
