-- =========================================================
-- Усиление защиты таблицы records (выполнить после schema.sql)
-- 1) updated_at не дальше суток в будущем — иначе запись «замораживается» для last-write-wins
-- 2) Квота на пользователя: 20 000 записей и 50 МБ — защита от заливки базы чужим аккаунтом
-- 3) Ролям API не нужен EXECUTE на триггерные функции
-- =========================================================
alter table public.records drop constraint if exists records_updated_at_range;
alter table public.records add constraint records_updated_at_range check (updated_at >= 0);

create or replace function public.records_lww()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 86400000;
begin
  if new.updated_at > max_ms then
    new.updated_at := max_ms;
  end if;
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_ts := clock_timestamp();
  return new;
end;
$$;

create or replace function public.records_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bad record;
begin
  select r.user_id, count(*) as n, coalesce(sum(pg_column_size(r.data)), 0) as bytes
    into bad
    from public.records r
   where r.user_id in (select distinct user_id from new_rows)
   group by r.user_id
  having count(*) > 20000 or coalesce(sum(pg_column_size(r.data)), 0) > 50 * 1024 * 1024
   limit 1;
  if found then
    raise exception 'quota exceeded: % records, % bytes', bad.n, bad.bytes using errcode = '53400';
  end if;
  return null;
end;
$$;

drop trigger if exists records_quota_ins on public.records;
create trigger records_quota_ins after insert on public.records
  referencing new table as new_rows for each statement execute function public.records_quota();
drop trigger if exists records_quota_upd on public.records;
create trigger records_quota_upd after update on public.records
  referencing new table as new_rows for each statement execute function public.records_quota();

revoke execute on function public.records_lww() from public, anon, authenticated;
revoke execute on function public.records_quota() from public, anon, authenticated;
