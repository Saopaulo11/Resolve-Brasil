import { formatBrazilianPhone } from "../utils/phone";
import { stores } from "../users/storeRegistry";

/**
 * Выгрузка собственных данных (§64).
 *
 * Здесь телефон показывается полностью и текст обращений — тоже: это
 * данные самого человека, и право на них у него есть. Маскирование,
 * уместное в журналах и в админке, здесь было бы издевательством.
 *
 * Содержимого файлов в выгрузке нет: она пошла бы архивом на десятки
 * мегабайт. Каждый документ перечислен, и скачать его можно со страницы
 * своего дела.
 */
export type DataExport = {
  exportedAt: string;
  aviso: string;
  conta: Record<string, unknown>;
  consentimentos: Array<Record<string, unknown>>;
  casos: Array<Record<string, unknown>>;
  lembretes: Array<Record<string, unknown>>;
  notificacoes: Array<Record<string, unknown>>;
};

export async function buildExport(userId: string): Promise<DataExport | null> {
  const { users, cases, documents, facts, reminders, notifications } = stores();

  const user = await users.findById(userId);
  if (!user) return null;

  const userCases = await cases.listForUser(userId);

  const casos = await Promise.all(
    userCases.map(async (item) => ({
      numero: item.publicId,
      categoria: item.category,
      empresa: item.companyName,
      valor: item.amount,
      moeda: item.currency,
      formaDePagamento: item.paymentMethod,
      status: item.status,
      relato: item.description,
      criadoEm: item.createdAt.toISOString(),
      atualizadoEm: item.updatedAt.toISOString(),
      linhaDoTempo: (await cases.listEvents(item.id)).map((event) => ({
        data: event.eventDate.toISOString(),
        titulo: event.title,
        descricao: event.description,
        origem: event.source,
      })),
      mensagens: (await cases.listMessages(item.id)).map((message) => ({
        quando: message.createdAt.toISOString(),
        direcao: message.direction,
        tipo: message.type,
        conteudo: message.content,
      })),
      documentos: (await documents.listForCase(item.id)).map((document) => ({
        nome: document.filename,
        tipo: document.kind,
        tamanhoBytes: document.fileSize,
        enviadoEm: document.createdAt.toISOString(),
      })),
      dadosExtraidos: (await facts.listForCase(item.id)).map((fact) => ({
        campo: fact.field,
        valor: fact.value,
        situacao: fact.status,
        origem: fact.source,
      })),
    })),
  );

  const userReminders = await Promise.all(
    userCases.map((item) => reminders.listForCase(item.id)),
  );

  return {
    exportedAt: new Date().toISOString(),
    aviso:
      "Este arquivo contém os dados que o Resolve Brasil guarda sobre você. " +
      "O conteúdo dos documentos enviados não está incluído: baixe cada um " +
      "na página do caso correspondente.",
    conta: {
      telefone: formatBrazilianPhone(user.phone),
      telefoneVerificado: user.phoneVerified,
      nome: user.displayName,
      criadaEm: user.createdAt.toISOString(),
      avisosSobreCasos: user.caseNotifications,
      marketing: user.marketingConsent,
      marketingAceitoEm: user.marketingConsentAt?.toISOString() ?? null,
      marketingCanceladoEm: user.marketingUnsubscribedAt?.toISOString() ?? null,
    },
    // Согласия лежат отдельным разделом: по ним видно, с какой редакцией
    // условий человек соглашался и когда.
    consentimentos: [],
    casos,
    lembretes: userReminders.flat().map((reminder) => ({
      titulo: reminder.title,
      agendadoPara: reminder.scheduledAt.toISOString(),
      situacao: reminder.status,
    })),
    notificacoes: (await notifications.listForUser(userId, 200)).map((item) => ({
      quando: item.createdAt.toISOString(),
      canal: item.channel,
      finalidade: item.purpose,
      situacao: item.status,
    })),
  };
}
