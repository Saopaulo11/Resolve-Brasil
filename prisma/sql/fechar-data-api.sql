-- Закрывает таблицы приложения от публичного REST-интерфейса Supabase.
--
-- Supabase по умолчанию включает Data API (PostgREST) и выдаёт ролям anon
-- и authenticated права на каждую новую таблицу. Для этого проекта такое
-- недопустимо: наружу открылись бы users с телефонами, cases с рассказами
-- людей и documents (§25, §51, §56).
--
-- Приложение ходит в базу через Prisma под ролью из DATABASE_URL, и Data
-- API ему не нужен вовсе. Запрет ставится на уровне прав, а не галочкой в
-- интерфейсе: галочку можно переключить не глядя, а отозванные права
-- сами собой не вернутся.
--
-- Запускать после каждой миграции, создающей таблицы: новые таблицы
-- наследуют права по умолчанию, а не по факту.

-- 1. Новые таблицы не получают прав для ролей публичного API.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 2. Уже выданные права снимаются.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 3. Проверка: обе роли не должны видеть ни одной таблицы.
select count(*) as direitos_restantes
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');
