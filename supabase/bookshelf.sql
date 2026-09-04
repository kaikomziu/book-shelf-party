-- ------------------------------------------------------------------
-- 本を棚に戻すゲーム(book-shelf-party) 用テーブル/RPC
-- 共有Supabaseプロジェクト kifnzvktwbomxthzvvgy の SQL Editor で
-- 初回に一度だけ実行してください。他サイトのテーブルには触れません。
-- ------------------------------------------------------------------

-- 部屋のメタ情報(冊数は部屋を最初に作った人が決め、以後固定)
create table if not exists public.bookshelf_rooms (
  room_code text primary key,
  total_books integer not null,
  created_at timestamptz not null default now()
);

alter table public.bookshelf_rooms enable row level security;

drop policy if exists "bookshelf_rooms_select" on public.bookshelf_rooms;
create policy "bookshelf_rooms_select" on public.bookshelf_rooms
  for select using (true);

-- 本1冊ごとの「触られた」状態だけを持つ(floorはレコード無しで表現)
create table if not exists public.bookshelf_book_state (
  room_code text not null,
  book_id integer not null,
  state text not null check (state in ('held', 'placed')),
  holder_id text,
  updated_at timestamptz not null default now(),
  primary key (room_code, book_id)
);

alter table public.bookshelf_book_state enable row level security;

drop policy if exists "bookshelf_book_state_select" on public.bookshelf_book_state;
create policy "bookshelf_book_state_select" on public.bookshelf_book_state
  for select using (true);

-- Realtime配信対象に追加(これを忘れるとpostgres_changesが無音になる)
alter publication supabase_realtime add table public.bookshelf_book_state;

-- 部屋を取得、無ければ指定の冊数で新規作成する。
-- 既に存在する場合は既存の冊数を返す(先着優先、以後その部屋の冊数は変わらない)。
create or replace function public.bookshelf_get_or_create_room(p_room text, p_total int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  result integer;
  safe_total integer;
begin
  -- クライアントを介さずRPCを直接叩かれても、想定外の冊数(0や巨大な値)で
  -- 部屋が作られてしまわないように許可された値だけに制限する。
  safe_total := case when p_total in (500, 1000, 2000) then p_total else 500 end;

  insert into public.bookshelf_rooms (room_code, total_books)
  values (p_room, safe_total)
  on conflict (room_code) do nothing;

  select total_books into result from public.bookshelf_rooms where room_code = p_room;
  return result;
end;
$$;

-- 本を拾う。既にheld/placedなら何もせずfalseを返す(取り合い対策)。
create or replace function public.bookshelf_pickup(p_room text, p_book_id int, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bookshelf_book_state (room_code, book_id, state, holder_id)
  values (p_room, p_book_id, 'held', p_holder)
  on conflict (room_code, book_id) do nothing;

  return exists (
    select 1 from public.bookshelf_book_state
    where room_code = p_room and book_id = p_book_id and state = 'held' and holder_id = p_holder
  );
end;
$$;

-- 自分が持っている本を正しい棚に置く。
create or replace function public.bookshelf_place(p_room text, p_book_id int, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.bookshelf_book_state
  set state = 'placed', holder_id = null, updated_at = now()
  where room_code = p_room and book_id = p_book_id and state = 'held' and holder_id = p_holder;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- 持っている本を手放して床に戻す(拾い間違い・離脱時など)。
create or replace function public.bookshelf_drop(p_room text, p_book_id int, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  delete from public.bookshelf_book_state
  where room_code = p_room and book_id = p_book_id and state = 'held' and holder_id = p_holder;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- 指定プレイヤーが保持している本をすべて手放す(退室・切断時に他クライアントから呼ばれる)。
create or replace function public.bookshelf_release_all(p_room text, p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.bookshelf_book_state
  where room_code = p_room and holder_id = p_holder and state = 'held';
$$;

grant execute on function public.bookshelf_get_or_create_room(text, int) to anon, authenticated;
grant execute on function public.bookshelf_pickup(text, int, text) to anon, authenticated;
grant execute on function public.bookshelf_place(text, int, text) to anon, authenticated;
grant execute on function public.bookshelf_drop(text, int, text) to anon, authenticated;
grant execute on function public.bookshelf_release_all(text, text) to anon, authenticated;

-- 誰でも出入りできる公開ルーム(1000冊)をあらかじめ用意しておく
insert into public.bookshelf_rooms (room_code, total_books)
values ('PUBLIC', 1000)
on conflict (room_code) do nothing;
