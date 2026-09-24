import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness } from "../helpers/auth";

/**
 * Поле вложений на странице (§6).
 *
 * Родное поле выбора файла выглядит на каждой системе по-своему и на части
 * телефонов подписано на чужом языке. Здесь проверяется, что человек видит
 * свои слова и знает пределы до того, как выберет файл.
 */

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

describe("поле вложений", () => {
  it("называет действие, форматы и пределы", async () => {
    const pagina = await request(harness.app).get("/");

    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain("Adicionar documento");
    expect(pagina.text).toContain(
      "Arraste o arquivo aqui ou escolha do dispositivo",
    );
    expect(pagina.text).toMatch(/PDF, JPG, PNG ou WEBP · até \d+ MB/);
    expect(pagina.text).toContain("Escolher arquivo");
    expect(pagina.text).toContain("Tirar foto");
  });

  it("поле выбора остаётся в разметке и принимает несколько файлов", async () => {
    // Оно и есть рабочая часть: без скрипта человек пользуется именно им.
    const pagina = await request(harness.app).get("/");

    const entrada = /<input[^>]*data-upload-entrada[^>]*>/.exec(pagina.text)?.[0] ?? "";
    expect(entrada).toContain('type="file"');
    expect(entrada).toContain("multiple");
    expect(entrada).toContain('name="arquivo"');
    // Камера отдельным полем: на телефоне она открывает камеру, а не список.
    expect(pagina.text).toMatch(/<input[^>]*data-upload-camera[^>]*>/);
    expect(pagina.text).toContain('capture="environment"');
  });

  it("предел числа файлов и размера уходит в разметку", async () => {
    // По ним скрипт считает, сколько ещё можно добавить.
    const pagina = await request(harness.app).get("/");

    expect(pagina.text).toMatch(/data-upload-max="\d+"/);
    expect(pagina.text).toMatch(/data-upload-bytes="\d+"/);
  });
});
