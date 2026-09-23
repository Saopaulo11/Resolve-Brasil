import { loadConfig } from "../config/env";
import { storageProvider } from "../documents/storage";
import { logger } from "../utils/logger";
import { stores } from "../users/storeRegistry";
import type { DeletionRequestRecord } from "./privacyStore";

/**
 * Удаление данных по запросу пользователя (§64).
 *
 * Не удаляем сразу намеренно. Дело может быть в разгаре, и человек лишится
 * того, ради чего пришёл. А захваченная учётная запись иначе позволяет
 * стереть всё одним нажатием, и владелец узнаёт слишком поздно. Отсрочка
 * даёт возможность отменить.
 */
export type RequestResult =
  | { ok: true; request: DeletionRequestRecord }
  | { ok: false; reason: "ja_solicitado" };

export async function requestDeletion(input: {
  userId: string;
  reason: string | null;
  ipPrefix: string | null;
}): Promise<RequestResult> {
  const config = loadConfig();
  const { deletionRequests } = stores();

  const existing = await deletionRequests.findPendingForUser(input.userId);
  if (existing) return { ok: false, reason: "ja_solicitado" };

  const request = await deletionRequests.create({
    userId: input.userId,
    reason: input.reason,
    executeAfter: new Date(
      Date.now() + config.privacy.deletionGraceDays * 24 * 60 * 60 * 1000,
    ),
    ipPrefix: input.ipPrefix,
  });

  return { ok: true, request };
}

export async function cancelDeletion(userId: string): Promise<boolean> {
  const { deletionRequests } = stores();

  const pending = await deletionRequests.findPendingForUser(userId);
  if (!pending) return false;

  await deletionRequests.cancel(pending.id, new Date());
  return true;
}

export async function pendingDeletion(
  userId: string,
): Promise<DeletionRequestRecord | null> {
  return stores().deletionRequests.findPendingForUser(userId);
}

export type ExecutionResult = { executed: number; failed: number };

/**
 * Исполнение наступивших запросов.
 *
 * Порядок важен: сначала файлы из хранилища, потом дела, потом сам
 * пользователь. Если удалить пользователя первым, ключи файлов станут
 * недостижимы, и файлы останутся в хранилище навсегда.
 *
 * Обезличенные слепки в аналитике не удаляются: в них нет ничего, что
 * ведёт к человеку, и связи с делом у них тоже нет. Журнал доступа не
 * удаляется по той же причине — он про действия администраторов.
 */
export async function executeDueDeletions(limit = 50): Promise<ExecutionResult> {
  const { deletionRequests, cases, documents, users } = stores();

  const due = await deletionRequests.listDue(new Date(), limit);
  const result: ExecutionResult = { executed: 0, failed: 0 };

  for (const request of due) {
    try {
      const userCases = await cases.listForUser(request.userId);

      for (const item of userCases) {
        for (const document of await documents.listForCase(item.id)) {
          await storageProvider().remove(document.storageKey);
          await documents.hardDelete(document.id);
        }
        await cases.deleteCase(item.id);
      }

      await users.deleteUser(request.userId);
      await deletionRequests.markExecuted(request.id, new Date());
      result.executed += 1;
    } catch (error) {
      logger().error(
        { err: error, requestId: request.id },
        "falha ao executar exclusão de dados",
      );
      result.failed += 1;
    }
  }

  return result;
}
