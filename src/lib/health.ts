/** Формат ответа GET /api/health. Общий для маршрута и для клиента. */
export type HealthCheck = { ok: boolean; detail: string };

export type HealthReport = {
  status: "ok" | "error";
  checks: {
    config: HealthCheck;
    database: HealthCheck;
  };
  tookMs: number;
  checkedAt: string;
};
