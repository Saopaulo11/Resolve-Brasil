import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createHarness,
  login,
  mergeCookies,
  openPage,
  type Harness,
} from "../helpers/auth";

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

/**
 * Атрибут, собранный целиком внутри выводящего тега шаблона, приезжает с
 * экранированными кавычками: браузер получает `aria-invalid=&#34;true&#34;`,
 * значением считает `"true"` вместе с кавычками — и разметку не понимает.
 * На глаз страница выглядит правильно, поэтому замечает это только тест.
 */
const ATRIBUTO_ESCAPADO = /\s[a-z-]+=&#3[49];/;

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

  it("ни один атрибут не приезжает экранированным", async () => {
    for (const [caminho, html] of await paginasPublicas()) {
      expect(html, caminho).not.toMatch(ATRIBUTO_ESCAPADO);
    }
  });

  it("в навигации отмечена текущая страница", async () => {
    // Без aria-current человек со скринридером слышит список одинаковых
    // ссылок и не понимает, на какой из них он уже находится.
    const sobre = await request(harness.app).get("/sobre");
    expect(sobre.text).toContain('aria-current="page"');

    const inicio = await request(harness.app).get("/");
    expect(inicio.text).not.toContain("aria-current");
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

describe("поля с ошибкой", () => {
  it("текст дела: пометка об ошибке доходит до скринридера", async () => {
    const home = await openPage(harness.app, "/");
    const resposta = await request(harness.app)
      .post("/caso/novo")
      .set("Cookie", home.cookies)
      .type("form")
      .send({ _csrf: home.token, description: "curto" });

    expect(resposta.status).toBe(400);
    expect(resposta.text).toContain('aria-invalid="true"');
    expect(resposta.text).not.toMatch(ATRIBUTO_ESCAPADO);
  });

  it("телефон: пометка об ошибке доходит до скринридера", async () => {
    const entrar = await openPage(harness.app, "/entrar");
    const resposta = await request(harness.app)
      .post("/entrar")
      .set("Cookie", entrar.cookies)
      .type("form")
      .send({ _csrf: entrar.token, phone: "123" });

    expect(resposta.status).toBe(400);
    expect(resposta.text).toContain('aria-invalid="true"');
    expect(resposta.text).not.toMatch(ATRIBUTO_ESCAPADO);
  });

  it("код подтверждения: пометка об ошибке доходит до скринридера", async () => {
    const entrar = await openPage(harness.app, "/entrar");
    const enviado = await request(harness.app)
      .post("/entrar")
      .set("Cookie", entrar.cookies)
      .type("form")
      .send({ _csrf: entrar.token, phone: "11987654321" });

    const codigo = await openPage(
      harness.app,
      "/entrar/codigo",
      mergeCookies(entrar.cookies, (enviado.headers["set-cookie"] as unknown as string[]) ?? []),
    );

    const resposta = await request(harness.app)
      .post("/entrar/codigo")
      .set("Cookie", codigo.cookies)
      .type("form")
      .send({ _csrf: codigo.token, code: "abc" });

    expect(resposta.status).toBe(400);
    expect(resposta.text).toContain('aria-invalid="true"');
    expect(resposta.text).not.toMatch(ATRIBUTO_ESCAPADO);
  });
});
