-- =========================================================
-- Рейтинг пользователей. Выполнить один раз в SQL Editor (идемпотентно).
-- Участие по желанию: строка появляется, только когда человек сам включил рейтинг.
-- Каждый читает и меняет лишь свою строку; общий список отдаёт функция
-- get_leaderboard, которая возвращает ник, уровень и очки без user_id и email.
-- =========================================================
create table if not exists public.leaderboard (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nick       text not null check (char_length(nick) between 2 and 24 and nick !~ '[[:cntrl:]<>]'),
  week_start date not null,
  week_xp    integer not null default 0 check (week_xp between 0 and 20000),
  total_xp   integer not null default 0 check (total_xp between 0 and 10000000),
  level      integer not null default 0 check (level between 0 and 1000),
  strength   integer check (strength between 0 and 2000),
  updated_at timestamptz not null default now()
);
create unique index if not exists leaderboard_nick_unique on public.leaderboard (lower(nick));

create or replace function public.leaderboard_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists leaderboard_touch on public.leaderboard;
create trigger leaderboard_touch before insert or update on public.leaderboard
  for each row execute function public.leaderboard_touch();

alter table public.leaderboard enable row level security;
drop policy if exists "leaderboard_select_own" on public.leaderboard;
create policy "leaderboard_select_own" on public.leaderboard for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "leaderboard_insert_own" on public.leaderboard;
create policy "leaderboard_insert_own" on public.leaderboard for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "leaderboard_update_own" on public.leaderboard;
create policy "leaderboard_update_own" on public.leaderboard for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "leaderboard_delete_own" on public.leaderboard;
create policy "leaderboard_delete_own" on public.leaderboard for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.leaderboard from anon;
revoke truncate, references, trigger on public.leaderboard from authenticated;
grant select, insert, update, delete on public.leaderboard to authenticated;
revoke execute on function public.leaderboard_touch() from public, anon, authenticated;

-- Общий список: топ-100 + своя строка. Неделя считается по Праге (понедельник).
create or replace function public.get_leaderboard(board text)
returns table (rank integer, nick text, score integer, level integer, me boolean)
language sql stable security definer set search_path = '' as $$
  with cur as (select (date_trunc('week', now() at time zone 'Europe/Prague'))::date as wk),
  s as (
    select l.nick, l.level, l.user_id = auth.uid() as me,
           case when board = 'strength' then coalesce(l.strength, 0)
                when l.week_start = (select wk from cur) then l.week_xp else 0 end as score
    from public.leaderboard l
  ),
  r as (select (row_number() over (order by score desc, lower(nick)))::integer as rank, nick, score, level, me from s where score > 0 or me)
  select rank, nick, score, level, me from r where rank <= 100 or me order by rank;
$$;
revoke execute on function public.get_leaderboard(text) from public, anon;
grant execute on function public.get_leaderboard(text) to authenticated;
