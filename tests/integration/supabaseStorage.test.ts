import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../src/config/env";
import { resetStorageProviderCache, storageProvider } from "../../src/documents/storage";

/**
 * Приватное хранилище документов на Supabase Storage (§25).
 *
 * Проверяется против настоящего HTTP-сервера, а не подменённого fetch:
 * заголовки, тело и коды ответа — это и есть договор с хранилищем, и
 * подменённый клиент проверял бы только наши же представления о нём.
 */
const CHAVE = "chave-de-servico-que-nao-deve-vazar-em-lugar-nenhum";

type Recebido = {
  method: string;
  url: string;
  authorization: string | undefined;
  upsert: string | undefined;
  contentType: string | undefined;
  body: Buffer;
};

let server: http.Server;
let recebidos: Recebido[];
let responder: (req: Recebido) => { status: number; body?: string | Buffer };

beforeEach(async () => {
  recebidos = [];
  responder = () => ({ status: 200, body: "" });

  server = http.createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (chunk: Buffer) => partes.push(chunk));
    req.on("end", () => {
      const entrada: Recebido = {
        method: req.method ?? "",
        url: req.url ?? "",
        authorization: req.headers.authorization,
        upsert: req.headers["x-upsert"] as string | undefined,
        contentType: req.headers["content-type"],
        body: Buffer.concat(partes),
      };
      recebidos.push(entrada);

      const resposta = responder(entrada);
      res.writeHead(resposta.status, { "content-type": "application/json" });
      res.end(resposta.body ?? "");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  process.env.STORAGE_PROVIDER = "supabase";
  process.env.STORAGE_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.STORAGE_BUCKET = "documentos";
  process.env.STORAGE_SECRET_KEY = CHAVE;
  resetConfigCache();
  resetStorageProviderCache();
});

afterEach(async () => {
  delete process.env.STORAGE_PROVIDER;
  delete process.env.STORAGE_ENDPOINT;
  delete process.env.STORAGE_BUCKET;
  delete process.env.STORAGE_SECRET_KEY;
  resetConfigCache();
  resetStorageProviderCache();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("отправка файла", () => {
  it("кладёт содержимое в приватный бакет и не разрешает перезапись", async () => {
    responder = () => ({ status: 200, body: "{}" });

    await storageProvider().put("casos/abc/doc.pdf", Buffer.from("conteudo"), "application/pdf");

    expect(recebidos).toHaveLength(1);
    const pedido = recebidos[0]!;
    expect(pedido.method).toBe("POST");
    expect(pedido.url).toBe("/storage/v1/object/documentos/casos/abc/doc.pdf");
    expect(pedido.authorization).toBe(`Bearer ${CHAVE}`);
    expect(pedido.contentType).toBe("application/pdf");
    // Ключ уникален по построению: перезапись означала бы столкновение.
    expect(pedido.upsert).toBe("false");
    expect(pedido.body.toString()).toBe("conteudo");
  });

  it("отказ хранилища не выносит наружу ни ключ, ни ответ", async () => {
    responder = () => ({
      status: 403,
      body: JSON.stringify({ message: `token ${CHAVE} inválido para bucket documentos` }),
    });

    await expect(
      storageProvider().put("casos/abc/doc.pdf", Buffer.from("x"), "application/pdf"),
    ).rejects.toThrow(/HTTP 403/);

    await storageProvider()
      .put("casos/abc/doc2.pdf", Buffer.from("x"), "application/pdf")
      .catch((erro: Error) => {
        expect(erro.message).not.toContain(CHAVE);
        expect(erro.message).not.toContain("inválido para bucket");
      });
  });
});

describe("чтение и удаление", () => {
  it("возвращает содержимое файла", async () => {
    responder = () => ({ status: 200, body: Buffer.from("conteudo do pdf") });

    const dados = await storageProvider().get("casos/abc/doc.pdf");

    expect(dados.toString()).toBe("conteudo do pdf");
    expect(recebidos[0]?.authorization).toBe(`Bearer ${CHAVE}`);
  });

  it("удаление отсутствующего файла не считается ошибкой", async () => {
    // Сроки хранения и запрос на удаление данных доходят до одного файла
    // дважды — второй заход не должен ронять всю уборку.
    responder = () => ({ status: 404, body: "{}" });

    await expect(storageProvider().remove("casos/abc/doc.pdf")).resolves.toBeUndefined();
    expect(recebidos[0]?.method).toBe("DELETE");
  });

  it("другой отказ при удалении всё-таки ошибка", async () => {
    responder = () => ({ status: 500, body: "{}" });
    await expect(storageProvider().remove("casos/abc/doc.pdf")).rejects.toThrow(/HTTP 500/);
  });
});

describe("подписанная ссылка", () => {
  it("складывается в полный адрес", async () => {
    responder = () => ({
      status: 200,
      body: JSON.stringify({ signedURL: "/object/sign/documentos/casos/abc/doc.pdf?token=abc" }),
    });

    const url = await storageProvider().signedUrl("casos/abc/doc.pdf", 60);

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/storage\/v1\/object\/sign\//);
    expect(JSON.parse(recebidos[0]!.body.toString())).toEqual({ expiresIn: 60 });
  });

  it("ответ без адреса — отказ, а не пустая ссылка", async () => {
    responder = () => ({ status: 200, body: JSON.stringify({}) });
    await expect(storageProvider().signedUrl("casos/abc/doc.pdf", 60)).rejects.toThrow(
      /sem endereço/,
    );
  });
});

describe("неполная настройка", () => {
  it("называет недостающие переменные по именам", () => {
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_SECRET_KEY;
    resetConfigCache();
    resetStorageProviderCache();

    expect(() => storageProvider()).toThrow(/STORAGE_ENDPOINT/);
    expect(() => storageProvider()).toThrow(/STORAGE_SECRET_KEY/);
  });
});
