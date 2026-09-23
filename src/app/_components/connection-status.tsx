"use client";

import { useEffect, useState } from "react";

import type { HealthReport } from "@/lib/health";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; report: HealthReport }
  | { kind: "unreachable"; detail: string };

/**
 * Один запрос к /api/health. Функция чистая относительно React — ничего не
 * трогает в состоянии, а возвращает результат. Так setState остаётся внутри
 * колбэка, а не в теле эффекта (react-hooks/set-state-in-effect).
 */
async function fetchHealth(): Promise<State> {
  try {
    // Ответ бывает 503 — это валидный отчёт, а не сбой запроса.
    const response = await fetch("/api/health", { cache: "no-store" });
    return { kind: "loaded", report: (await response.json()) as HealthReport };
  } catch (cause) {
    return {
      kind: "unreachable",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Показывает живой ответ /api/health. Проверка живёт в клиентском компоненте
 * намеренно: главная остаётся статической, и `next build` проходит даже там,
 * где ключей Supabase нет — например в CI.
 */
export function ConnectionStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchHealth().then((next) => {
      // Страницу могли закрыть, пока проверка шла.
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refresh() {
    setState({ kind: "loading" });
    void fetchHealth().then(setState);
  }

  return (
    <>
      <dl>{rows(state)}</dl>
      <button type="button" onClick={refresh} disabled={state.kind === "loading"}>
        Проверить снова
      </button>
    </>
  );
}

function rows(state: State) {
  if (state.kind === "loading") {
    return (
      <div className="row">
        <dt>Состояние</dt>
        <dd className="state-pending">проверяю…</dd>
      </div>
    );
  }

  if (state.kind === "unreachable") {
    return (
      <>
        <div className="row">
          <dt>Состояние</dt>
          <dd className="state-fail">/api/health не отвечает</dd>
        </div>
        <div className="row">
          <dt>Причина</dt>
          <dd>{state.detail}</dd>
        </div>
      </>
    );
  }

  const { checks, tookMs } = state.report;

  return (
    <>
      <div className="row">
        <dt>Конфигурация</dt>
        <dd className={checks.config.ok ? "state-ok" : "state-fail"}>
          {checks.config.ok ? "задана" : "не задана"} — {checks.config.detail}
        </dd>
      </div>
      <div className="row">
        <dt>База</dt>
        <dd className={checks.database.ok ? "state-ok" : "state-fail"}>
          {checks.database.ok ? "отвечает" : "недоступна"} — {checks.database.detail}
        </dd>
      </div>
      <div className="row">
        <dt>Заняло</dt>
        <dd>{tookMs} мс</dd>
      </div>
    </>
  );
}
