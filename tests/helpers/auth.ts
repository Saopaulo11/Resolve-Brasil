import request from "supertest";
import type { Express } from "express";

import { createApp } from "../../src/createApp";
import { setOtpProvider } from "../../src/users/otpProvider";
import {
  createMemoryStores,
  type MemoryStores,
} from "../../src/users/memoryStoreSet";
import { setStores } from "../../src/users/storeRegistry";
import type { OtpProvider } from "../../src/users/otpProvider";

/** Провайдер, который не отправляет код, а запоминает его. */
export class CapturingOtpProvider implements OtpProvider {
  readonly name = "capturing";
  readonly sent: Array<{ phone: string; code: string }> = [];

  async send(phone: string, code: string): Promise<{ delivered: boolean }> {
    this.sent.push({ phone, code });
    return { delivered: true };
  }

  lastCodeFor(phone: string): string {
    const entry = [...this.sent].reverse().find((item) => item.phone === phone);
    if (!entry) throw new Error(`Nenhum código enviado para ${phone}`);
    return entry.code;
  }
}

export type Harness = MemoryStores & {
  app: Express;
  otpProvider: CapturingOtpProvider;
};

/** Свежее приложение с хранилищами в памяти — каждый тест изолирован. */
export function createHarness(): Harness {
  const stores = createMemoryStores();
  setStores(stores);

  const otpProvider = new CapturingOtpProvider();
  setOtpProvider(otpProvider);

  return { ...stores, app: createApp(), otpProvider };
}

/** CSRF-токен и куки со страницы — так же, как их берёт браузер. */
export async function openPage(app: Express, path: string, cookies: string[] = []) {
  const response = await request(app).get(path).set("Cookie", cookies);
  const token = /name="_csrf" value="([^"]+)"/.exec(response.text)?.[1] ?? "";
  const received = (response.headers["set-cookie"] as unknown as string[]) ?? [];
  return { response, token, cookies: mergeCookies(cookies, received) };
}

/** Supertest не ведёт банку кук — склеиваем вручную, новые перекрывают старые. */
export function mergeCookies(current: string[], incoming: string[]): string[] {
  const jar = new Map<string, string>();
  for (const cookie of [...current, ...incoming]) {
    const name = cookie.split("=")[0];
    if (name) jar.set(name, cookie.split(";")[0] ?? cookie);
  }
  return [...jar.values()];
}

/**
 * Полный вход: телефон → код → сессия. Возвращает куки вошедшего.
 *
 * options.cookies — куки уже начатой сессии браузера. Нужны, когда человек
 * сначала описал проблему гостем: в них лежит номер начатого дела.
 */
export async function login(
  harness: Harness,
  phone: string,
  options: { marketing?: boolean; cookies?: string[] } = {},
): Promise<string[]> {
  const { app, otpProvider } = harness;

  const start = await openPage(app, "/entrar", options.cookies ?? []);
  const sent = await request(app)
    .post("/entrar")
    .set("Cookie", start.cookies)
    .type("form")
    .send({ _csrf: start.token, phone, next: "/minha-conta" });

  const afterSend = mergeCookies(
    start.cookies,
    (sent.headers["set-cookie"] as unknown as string[]) ?? [],
  );

  const codePage = await openPage(app, "/entrar/codigo", afterSend);
  const code = otpProvider.lastCodeFor(normalize(phone));

  const confirmed = await request(app)
    .post("/entrar/codigo")
    .set("Cookie", codePage.cookies)
    .type("form")
    .send({
      _csrf: codePage.token,
      code,
      next: "/minha-conta",
      ...(options.marketing ? { marketing: "on" } : {}),
    });

  return mergeCookies(
    codePage.cookies,
    (confirmed.headers["set-cookie"] as unknown as string[]) ?? [],
  );
}

function normalize(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^55/, "");
  return `+55${digits}`;
}
