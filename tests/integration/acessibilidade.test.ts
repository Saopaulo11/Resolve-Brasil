import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, login, openPage, type Harness } from "../helpers/auth";

/**
 * Доступность отрендеренных страниц (§70).
 *
 * Проверяется то, что ломается молча и чинится дёшево: поле без подписи,
 * картинка без альтернативы, страница без языка. Человек со скринридером
 * на поле без подписи слышит «edit text» и не знает, что вводить, — а на
 * глаз страница выглядит нормально, поэтому такую регрессию замечает
 * только тест.
 */
let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

/** Поля ввода, которым подпись не нужна по устройству. */
const SEM_LABEL = new Set(["hidden", "submit", "button", "image"]);

function camposSemLabel(html: string): string[] {
  const ids = new Set(
    [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((match) => match[1] as string),
  );

  const problemas: string[] = [];

  for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const tag = match[1] as string;
    const attrs = match[2] as string;

    const type = /\btype="([^"]+)"/.exec(attrs)?.[1] ?? "text";
    if (tag === "input" && SEM_LABEL.has(type)) continue;

    // Собственная подпись на элементе тоже считается подписью.
    if (/\baria-label(?:ledby)?="/.test(attrs)) continue;

    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (id && ids.has(id)) continue;

    problemas.push(`${tag}[type=${type}] ${id ? `#${id}` : "без id"}`);
  }

  return problemas;
}

function imagensSemAlt(html: string): string[] {
  return [...html.matchAll(/<img\b([^>]*)>/g)]
    .map((match) => match[1] as string)
    .filter((attrs) => !/\balt="/.test(attrs));
}

async function paginasPublicas(): Promise<Array<[string, string]>> {
  const caminhos = ["/", "/entrar", "/como-funciona", "/privacidade", "/termos"];
  const paginas: Array<[string, string]> = [];

  for (const caminho of caminhos) {
    const response = await request(harness.app).get(caminho);
    paginas.push([caminho, response.text]);
  }

  return paginas;
}

describe("публичные страницы", () => {
  it("у каждого поля ввода есть подпись", async () => {
    for (const [caminho, html] of await paginasPublicas()) {
      expect(camposSemLabel(html), caminho).toEqual([]);
    }
  });

  it("у каждой картинки есть альтернативный текст", async () => {
    for (const [caminho, html] of await paginasPublicas()) {
      expect(imagensSemAlt(html), caminho).toEqual([]);
    }
  });

  it("язык страницы объявлен", async () => {
    // Без lang скринридер читает португальский текст английскими правилами.
    for (const [caminho, html] of await paginasPublicas()) {
      expect(html, caminho).toContain('<html lang="pt-BR">');
    }
  });

  it("есть ссылка «к содержимому»", async () => {
    // Без неё человек на клавиатуре проходит всю навигацию на каждой
    // странице, прежде чем добраться до текста.
    for (const [caminho, html] of await paginasPublicas()) {
      expect(html, caminho).toContain('class="skip-link"');
    }
  });
});

describe("страницы за входом", () => {
  it("дело и личный кабинет подписывают все поля", async () => {
    const cookies = await login(harness, "11987654321");

    const home = await openPage(harness.app, "/", cookies);
    const created = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token, description: "Comprei e não recebi o produto." });

    const publicId = /\/caso\/(RB-[A-Z2-9]{6})/.exec(created.headers.location ?? "")?.[1];

    for (const caminho of ["/minha-conta", `/caso/${publicId}`]) {
      const response = await request(harness.app).get(caminho).set("Cookie", cookies);
      expect(camposSemLabel(response.text), caminho).toEqual([]);
      expect(imagensSemAlt(response.text), caminho).toEqual([]);
    }
  });
});
