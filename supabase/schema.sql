-- =========================================================
-- Тренировки: схема облачной синхронизации (Supabase / Postgres)
-- Выполнить один раз: Supabase → SQL Editor → New query → Run.
-- Скрипт идемпотентный: повторный запуск ничего не ломает.
-- =========================================================

-- Одна универсальная таблица: каждая запись приложения (упражнение, тренировка,
-- шаблон, план недели) хранится как JSON. Так клиентская модель может меняться
-- без миграций БД.
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('exercises', 'workouts', 'templates', 'meta')),
  id         text        not null check (char_length(id) between 1 and 100),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at bigint      not null,                -- время изменения на устройстве, мс (для last-write-wins)
  server_ts  timestamptz not null default now(),  -- время записи на сервере (курсор для pull)
  primary key (user_id, kind, id),
  constraint records_data_size check (data is null or pg_column_size(data) < 256 * 1024)
);

create index if not exists records_user_server_ts on public.records (user_id, server_ts);

-- Last-write-wins: более старая правка не перезаписывает более новую,
-- даже если устройство долго было офлайн. server_ts всегда ставит сервер.
create or replace function public.records_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- пропустить обновление
  end if;
  new.server_ts := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
  before insert or update on public.records
  for each row execute function public.records_lww();

-- Row Level Security: пользователь видит и меняет только свои записи.
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
create policy "records_select_own" on public.records
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "records_insert_own" on public.records;
create policy "records_insert_own" on public.records
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "records_update_own" on public.records;
create policy "records_update_own" on public.records
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "records_delete_own" on public.records;
create policy "records_delete_own" on public.records
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.records from anon;
revoke truncate, references, trigger on public.records from authenticated; -- TRUNCATE обходит RLS
grant select, insert, update, delete on public.records to authenticated;
