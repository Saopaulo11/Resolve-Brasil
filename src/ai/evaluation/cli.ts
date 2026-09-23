import { aiProvider } from "..";
import { loadConfig } from "../../config/env";
import { stores } from "../../users/storeRegistry";
import { formatReport } from "./report";
import { evaluationPassed, runEvaluation } from "./runner";
import { loadDataset } from "./dataset";

/**
 * npm run ai:eval [-- --deep]
 *
 * Прогон набора через настроенного провайдера (§81). Запускается руками и
 * в CI перед сменой модели или промпта: «стало лучше» без цифры — это
 * мнение, а не результат.
 */
async function main(): Promise<void> {
  const deep = process.argv.includes("--deep");
  const config = loadConfig();

  if (config.ai.provider === "mock") {
    // §79: заглушка возвращает пустые структуры. Прогнать её можно, но
    // выдавать это за оценку модели нельзя — цифры будут о заглушке.
    console.error(
      "AI_PROVIDER=mock: оценивать нечего. Заглушка возвращает пустой результат,\n" +
        "и любые цифры прогона будут цифрами о заглушке, а не о модели.\n" +
        "Задайте AI_PROVIDER=openai, OPENAI_API_KEY и OPENAI_MODEL.",
    );
    process.exitCode = 1;
    return;
  }

  const dataset = loadDataset();

  // План проверяется только против подтверждённых источников: непроверенный
  // источник не должен попадать в запрос даже в прогоне (§32).
  const sources = deep
    ? (
        await stores().sources.listUsable(
          new Date(Date.now() - config.sources.maxAgeDays * 24 * 60 * 60_000),
          10,
        )
      ).map((source) => ({
        id: source.id,
        organization: source.organization,
        title: source.title,
        url: source.url,
      }))
    : [];

  if (deep && sources.length === 0) {
    console.warn(
      "Подтверждённых источников нет: план будет проверяться без них.\n" +
        "Это правильное поведение продукта, но проверка ссылок ничего не покажет.",
    );
  }

  const report = await runEvaluation(
    aiProvider(),
    dataset.cases,
    {
      confidenceThreshold: config.ai.classificationMinConfidence,
      sources,
      deep,
    },
    config.ai.openai.model,
  );

  console.log(formatReport(report));

  const verdict = evaluationPassed(report, config.ai.evalMinAccuracy);
  console.log("");
  if (verdict.ok) {
    console.log("Resultado: aprovado.");
    return;
  }

  console.error(`Resultado: reprovado — ${verdict.reasons.join("; ")}.`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
