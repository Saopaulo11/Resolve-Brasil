import { beforeEach, describe, expect, it } from "vitest";

import {
  checkUrl,
  importCandidates,
  usableSourceOptions,
  verifyAll,
} from "../../src/sources/sourceService";
import { createMemoryStores } from "../../src/users/memoryStoreSet";
import { setStores } from "../../src/users/storeRegistry";

let stores: ReturnType<typeof createMemoryStores>;
let sources: ReturnType<typeof createMemoryStores>["sources"];

const CANDIDATE = {
  organization: "Consumidor.gov.br",
  title: "Consumidor.gov.br — plataforma oficial",
  url: "https://www.consumidor.gov.br/",
  category: "consumidor",
};

beforeEach(() => {
  stores = createMemoryStores();
  sources = stores.sources;
  setStores(stores);
});

describe("импорт кандидатов", () => {
  it("добавляет государственный адрес", async () => {
    const result = await importCandidates([CANDIDATE]);
    expect(result.added).toBe(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("отвергает негосударственный адрес", async () => {
    const result = await importCandidates([
      { ...CANDIDATE, url: "https://blog.exemplo.com.br/direitos" },
    ]);
    expect(result.added).toBe(0);
    expect(result.rejected[0]?.reason).toBe("dominio");
  });

  it("не дублирует уже известный адрес", async () => {
    await importCandidates([CANDIDATE]);
    const again = await importCandidates([CANDIDATE]);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it("повторный импорт не сбрасывает подтверждение", async () => {
    // Иначе очередной импорт обнулял бы работу настоящей проверки.
    await importCandidates([CANDIDATE]);
    const stored = await sources.findByUrl(CANDIDATE.url);
    await sources.markVerified(stored!.id, new Date());

    await importCandidates([CANDIDATE]);

    const after = await sources.findByUrl(CANDIDATE.url);
    expect(after?.active).toBe(true);
    expect(after?.lastVerifiedAt).not.toBeNull();
  });
});

describe("что доходит до модели (§32)", () => {
  it("импортированный, но не проверенный источник не используется", async () => {
    // Самое важное свойство PHASE 6: непроверенная ссылка не существует.
    await importCandidates([CANDIDATE]);
    expect(await usableSourceOptions()).toHaveLength(0);
  });

  it("проверенный источник используется", async () => {
    await importCandidates([CANDIDATE]);
    const stored = await sources.findByUrl(CANDIDATE.url);
    await sources.markVerified(stored!.id, new Date());

    const usable = await usableSourceOptions();
    expect(usable).toHaveLength(1);
    expect(usable[0]?.url).toBe(CANDIDATE.url);
  });

  it("давно не проверявшийся источник перестаёт использоваться", async () => {
    // Процедуры и адреса меняются: ссылка, которую никто не открывал
    // полгода, показанная как подтверждённая, и есть «выдуманная».
    await importCandidates([CANDIDATE]);
    const stored = await sources.findByUrl(CANDIDATE.url);

    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await sources.markVerified(stored!.id, longAgo);

    expect(await usableSourceOptions()).toHaveLength(0);
  });

  it("ставший недоступным источник выключается, но не исчезает", async () => {
    await importCandidates([CANDIDATE]);
    const stored = await sources.findByUrl(CANDIDATE.url);
    await sources.markVerified(stored!.id, new Date());
    await sources.markUnavailable(stored!.id, "HTTP 404");

    expect(await usableSourceOptions()).toHaveLength(0);
    // Запись остаётся: то, что источник был и перестал открываться, — факт.
    expect(await sources.listAll()).toHaveLength(1);
    expect((await sources.findByUrl(CANDIDATE.url))?.content).toContain("404");
  });
});

describe("проверка адресов", () => {
  it("негосударственный адрес отсекается до сетевого запроса", async () => {
    // Важно, что сюда не уходит запрос: иначе проверка стала бы способом
    // заставить наш сервер сходить на произвольный адрес.
    const outcome = await checkUrl("https://blog.exemplo.com.br/direitos");
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("dominio");
    expect(outcome.status).toBeNull();
  });

  it("недоступный источник выключается, а не остаётся подтверждённым", async () => {
    // Заводим источник в обход импорта: адрес государственный по форме,
    // но открыть его не удастся.
    const record = await sources.upsert({
      organization: "Teste",
      title: "Endereço que não abre",
      url: "https://nao-existe-mesmo.gov.br/pagina",
      category: null,
    });
    await sources.markVerified(record.id, new Date());
    expect(await usableSourceOptions()).toHaveLength(1);

    const result = await verifyAll();

    expect(result.verified).toBe(0);
    expect(result.failed).toBe(1);
    // И главное: он перестал доходить до модели и до пользователя.
    expect(await usableSourceOptions()).toHaveLength(0);
  });
});
