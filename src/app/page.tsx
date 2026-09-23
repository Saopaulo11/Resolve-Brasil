import { ConnectionStatus } from "./_components/connection-status";

export default function Page() {
  return (
    <main>
      <h1>Resolve Brasil</h1>
      <p className="lede">
        Каркас: Next.js 16 (App Router) и Supabase. Продуктового кода тут пока
        нет — только то, без чего нельзя начать.
      </p>

      <section className="panel">
        <h2>Подключение к Supabase</h2>
        <ConnectionStatus />
      </section>

      <section className="panel">
        <h2>Что уже на месте</h2>
        <dl>
          <div className="row">
            <dt>
              <code>src/lib/supabase</code>
            </dt>
            <dd>клиенты для сервера и браузера плюс ленивая проверка ключей</dd>
          </div>
          <div className="row">
            <dt>
              <code>src/proxy.ts</code>
            </dt>
            <dd>обновление сессии Supabase до рендера (в Next.js 16 это proxy, не middleware)</dd>
          </div>
          <div className="row">
            <dt>
              <code>/api/health</code>
            </dt>
            <dd>диагностика стенда: 200, если база читается, иначе 503 с причиной</dd>
          </div>
          <div className="row">
            <dt>
              <code>supabase/migrations</code>
            </dt>
            <dd>схема базы в репозитории, а не только в облаке</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Дальше</h2>
        <ol>
          <li>
            Описать модель данных и положить её в <code>supabase/migrations</code>.
          </li>
          <li>Собрать страницы продукта вместо этой заглушки.</li>
          <li>
            Сменить <code>lang=&quot;ru&quot;</code> в <code>src/app/layout.tsx</code> на{" "}
            <code>pt-BR</code>, когда появится интерфейс для пользователей.
          </li>
        </ol>
      </section>
    </main>
  );
}
