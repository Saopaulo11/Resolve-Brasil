import type { DocumentKind, FactStatus } from "../generated/prisma/enums";

/**
 * Подписи для интерфейса, pt-BR.
 *
 * Имена полей приходят от модели в техническом виде (order_number). Показать
 * их человеку как есть — значит заставить его догадываться, что подтверждает.
 */
export const FIELD_LABELS: Record<string, string> = {
  company: "Empresa",
  amount: "Valor",
  purchase_date: "Data da compra",
  payment_method: "Forma de pagamento",
  order_number: "Número do pedido",
  promised_delivery_date: "Prazo de entrega",
  refund_amount: "Valor do reembolso",
  protocol: "Protocolo",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  NOTA_FISCAL: "Nota fiscal",
  COMPROVANTE_PIX: "Comprovante de Pix",
  PEDIDO: "Pedido",
  CONTRATO: "Contrato",
  CAPTURA_DE_TELA: "Captura de tela",
  EMAIL: "E-mail",
  CONVERSA: "Conversa",
  RESPOSTA_DA_EMPRESA: "Resposta da empresa",
  OUTRO: "Outro",
};

export const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  UNCONFIRMED: "Aguardando sua confirmação",
  CONFIRMED: "Confirmado por você",
  USER_CORRECTED: "Corrigido por você",
  REJECTED: "Descartado",
};

export const FACT_STATUS_TONE: Record<FactStatus, string> = {
  UNCONFIRMED: "atencao",
  CONFIRMED: "concluido",
  USER_CORRECTED: "concluido",
  REJECTED: "neutro",
};
