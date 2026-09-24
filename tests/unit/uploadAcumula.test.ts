import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Выбор файлов накапливается (§6).
 *
 * Клиентский скрипт тестами приложения не покрыт — он выполняется в
 * браузере. Но конкретно эта ошибка стоила возможности приложить больше
 * одного файла и выглядела как «второй вытесняет первый», поэтому за ней
 * стоит следить хотя бы на уровне исходника.
 *
 * Суть ошибки: браузер при каждом новом выборе заменяет input.files
 * целиком, а не дополняет. Обработчик сбрасывал накопленный список в пустой
 * и брал только что выбранное — накопленное терялось.
 */

const FONTE = readFileSync(
  path.resolve(__dirname, "../../public/js/app.js"),
  "utf8",
);

/** Тело обработчика выбора файлов. */
function manipuladorDeEscolha(): string {
  const inicio = FONTE.indexOf('entrada.addEventListener("change"');
  expect(inicio, "обработчик выбора не найден").toBeGreaterThan(-1);
  return FONTE.slice(inicio, FONTE.indexOf("});", inicio));
}

describe("накопление выбранных файлов", () => {
  it("обработчик дополняет список, а не заменяет его", () => {
    const corpo = manipuladorDeEscolha();

    expect(corpo).toContain("adicionar(entrada.files)");
    // Сброс накопленного — ровно та ошибка, что была.
    expect(corpo).not.toMatch(/escolhidos\s*=\s*\[\]/);
  });

  it("список обнуляется только при объявлении", () => {
    const zeragens = [...FONTE.matchAll(/escolhidos\s*=\s*\[\]/g)];
    expect(zeragens).toHaveLength(1);
    expect(FONTE.slice(0, zeragens[0]!.index)).toMatch(/var\s*$/);
  });

  it("файл убирается по своему идентификатору, а не по месту в списке", () => {
    // Место меняется при каждом добавлении: обработчик, запомнивший старое,
    // убрал бы не тот файл.
    expect(FONTE).toContain("atual.id !== item.id");
    expect(FONTE).not.toMatch(/escolhidos\.splice\(\s*indice/);
  });

  it("у каждого файла есть свой идентификатор и состояние", () => {
    expect(FONTE).toMatch(/id:\s*"a"\s*\+\s*sequencia/);
    expect(FONTE).toMatch(/estado:\s*limite\s*>\s*0/);
    expect(FONTE).toContain("ESTADOS");
  });

  it("камера тоже дополняет, а не заменяет", () => {
    const inicio = FONTE.indexOf('camera.addEventListener("change"');
    expect(inicio).toBeGreaterThan(-1);
    const corpo = FONTE.slice(inicio, FONTE.indexOf("});", inicio));
    expect(corpo).toContain("adicionar(camera.files)");
  });
});
