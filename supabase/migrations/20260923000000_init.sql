-- Resolve Brasil — начальная миграция.
--
-- Таблица нужна не приложению, а /api/health: без реального чтения проверка
-- здоровья подтверждала бы только доступность сети, но не то, что ключ верный
-- и политики RLS пускают анонимного читателя.

create table if not exists public.app_status (
  id smallint primary key default 1,
  label text not null,
  updated_at timestamptz not null default now(),
  constraint app_status_singleton check (id = 1)
);

-- RLS обязателен: таблица в схеме public доступна через REST, и без включённого
-- RLS publishable-ключ читал и писал бы её кто угодно.
alter table public.app_status enable row level security;

drop policy if exists "app_status: чтение всем" on public.app_status;
create policy "app_status: чтение всем"
  on public.app_status
  for select
  to anon, authenticated
  using (true);

-- Запись не разрешена никому: политики на insert/update/delete нет, значит
-- менять строку можно только secret-ключом или из SQL-редактора.

insert into public.app_status (id, label)
values (1, 'ok')
on conflict (id) do nothing;
