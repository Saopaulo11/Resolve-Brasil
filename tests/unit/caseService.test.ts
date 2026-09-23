import { beforeEach, describe, expect, it } from "vitest";

import { attachCaseToUser, createCase, getCaseForUser, listCases } from "../../src/cases/caseService";
import { createMemoryStores } from "../../src/users/memoryStoreSet";
import { setStores } from "../../src/users/storeRegistry";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let stores: ReturnType<typeof createMemoryStores>;
let cases: ReturnType<typeof createMemoryStores>["cases"];

beforeEach(() => {
  stores = createMemoryStores();
  cases = stores.cases;
  setStores(stores);
});

describe("создание дела", () => {
  it("выдаёт публичный номер в формате RB-XXXXXX", async () => {
    const created = await createCase({
      userId: ALICE,
      description: "Não recebi o produto.",
      category: null,
    });
    expect(created.publicId).toMatch(/^RB-[A-Z2-9]{6}$/);
  });

  it("заводит первое событие хронологии как факт пользователя", async () => {
    // §5: рассказ человека — USER_FACT, а не вывод модели.
    const created = await createCase({
      userId: ALICE,
      description: "Não recebi o produto.",
      category: null,
    });

    const events = await cases.listEvents(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("USER_FACT");
  });

  it("новое дело не классифицировано и не выдумывает категорию", async () => {
    const created = await createCase({
      userId: ALICE,
      description: "Alguma coisa deu errado.",
      category: null,
    });
    expect(created.category).toBeNull();
    expect(created.status).toBe("NOVO");
  });

  it("подбирает свободный номер при совпадении", async () => {
    // Совпадение практически невероятно, но отдать чужой номер дела нельзя
    // ни при какой вероятности — проверяем, что повтор не проходит насквозь.
    const first = await createCase({
      userId: ALICE,
      description: "Primeiro caso registrado aqui.",
      category: null,
    });

    let calls = 0;
    const original = cases.publicIdExists.bind(cases);
    cases.publicIdExists = async (publicId: string) => {
      calls += 1;
      // Первый подбор отвечаем «занято», дальше — как есть.
      return calls === 1 ? true : original(publicId);
    };

    const second = await createCase({
      userId: ALICE,
      description: "Segundo caso registrado aqui.",
      category: null,
    });

    expect(calls).toBeGreaterThan(1);
    expect(second.publicId).not.toBe(first.publicId);
  });
});

describe("доступ к делу", () => {
  it("владелец видит дело и хронологию", async () => {
    const created = await createCase({
      userId: ALICE,
      description: "Não recebi o produto.",
      category: null,
    });

    const found = await getCaseForUser(created.publicId, ALICE);
    expect(found?.case.publicId).toBe(created.publicId);
    expect(found?.timeline).toHaveLength(1);
  });

  it("чужак не видит ничего", async () => {
    const created = await createCase({
      userId: ALICE,
      description: "Não recebi o produto.",
      category: null,
    });

    expect(await getCaseForUser(created.publicId, BOB)).toBeNull();
  });

  it("список содержит только свои дела", async () => {
    await createCase({ userId: ALICE, description: "Caso da Alice.", category: null });
    await createCase({ userId: BOB, description: "Caso do Bob.", category: null });

    expect(await listCases(ALICE)).toHaveLength(1);
    expect(await listCases(BOB)).toHaveLength(1);
  });
});

describe("привязка дела после входа (§15)", () => {
  it("дело без владельца достаётся вошедшему", async () => {
    const created = await createCase({
      userId: null,
      description: "Comecei antes de entrar na conta.",
      category: null,
    });

    const attached = await attachCaseToUser(created.publicId, ALICE);
    expect(attached?.userId).toBe(ALICE);
    expect(await getCaseForUser(created.publicId, ALICE)).not.toBeNull();
  });

  it("чужое дело не перехватывается", async () => {
    // Это и есть настоящий запрет: даже если номер дела как-то оказался
    // у другого человека, вход не делает его владельцем.
    const created = await createCase({
      userId: ALICE,
      description: "Caso que já tem dono.",
      category: null,
    });

    expect(await attachCaseToUser(created.publicId, BOB)).toBeNull();

    const still = await getCaseForUser(created.publicId, ALICE);
    expect(still?.case.userId).toBe(ALICE);
    expect(await getCaseForUser(created.publicId, BOB)).toBeNull();
  });

  it("повторная привязка своим же не ломает дело", async () => {
    const created = await createCase({
      userId: null,
      description: "Comecei antes de entrar na conta.",
      category: null,
    });

    await attachCaseToUser(created.publicId, ALICE);
    const again = await attachCaseToUser(created.publicId, ALICE);
    expect(again?.userId).toBe(ALICE);
  });

  it("несуществующий номер ничего не привязывает", async () => {
    expect(await attachCaseToUser("RB-ZZZZZZ", ALICE)).toBeNull();
  });
});
