import { describe, expect, it } from "vitest";

import { isOfficialSourceUrl, validateSourceUrl } from "../../src/sources/policy";

/**
 * §30 в виде структурного запрета: модель физически не может подсунуть
 * блог вместо gov.br, потому что такой адрес не попадёт в базу.
 */
describe("что считается официальным источником", () => {
  it("принимает государственные домены", () => {
    expect(isOfficialSourceUrl("https://www.consumidor.gov.br/")).toBe(true);
    expect(isOfficialSourceUrl("https://www.gov.br/anatel/pt-br")).toBe(true);
    expect(isOfficialSourceUrl("https://www.procon.sp.gov.br/")).toBe(true);
    expect(isOfficialSourceUrl("https://www.stj.jus.br/")).toBe(true);
    expect(isOfficialSourceUrl("https://www.camara.leg.br/")).toBe(true);
  });

  it("отвергает блог и новостной сайт", () => {
    expect(validateSourceUrl("https://blog-do-consumidor.com.br/direitos")).toBe("dominio");
    expect(validateSourceUrl("https://noticias.exemplo.com/pix")).toBe("dominio");
  });

  it("отвергает домен, лишь похожий на государственный", () => {
    // Самая правдоподобная подделка: gov.br как часть чужого домена.
    expect(validateSourceUrl("https://www.gov.br.exemplo.com/")).toBe("dominio");
    expect(validateSourceUrl("https://govbr.com/")).toBe("dominio");
    expect(validateSourceUrl("https://fake-gov.br.co/")).toBe("dominio");
  });

  it("требует HTTPS", () => {
    // По http содержимое подменяется по пути — для источника, на который
    // человек будет опираться, этого достаточно, чтобы отказать.
    expect(validateSourceUrl("http://www.consumidor.gov.br/")).toBe("protocolo");
  });

  it("отвергает мусор вместо адреса", () => {
    expect(validateSourceUrl("не адрес")).toBe("formato");
    expect(validateSourceUrl("")).toBe("formato");
  });

  it("отвергает опасные схемы", () => {
    // javascript: и data: разбираются как валидные URL, поэтому отсекаются
    // проверкой протокола, а не формата. Важно, что отсекаются.
    expect(isOfficialSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isOfficialSourceUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isOfficialSourceUrl("file:///etc/passwd")).toBe(false);
  });
});
