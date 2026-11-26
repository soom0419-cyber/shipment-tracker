-- Shipment Tracker DB 스키마
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 한 번 실행합니다.
-- 테이블 3개(shipments, exception_types, activity_log) + 접속 코드용 내부 테이블.
-- 웹 화면(anon 키)은 SELECT/INSERT 와 아래 RPC 함수만 쓸 수 있고,
-- 직접 UPDATE/DELETE 는 막혀 있습니다. 모든 변경은 트리거가 activity_log 에 기록합니다.

-- ───────────── 타입 ─────────────
create type ship_status as enum (
  '선적 예정', '부킹 대기', '부킹 완료', '운송 중', '통관 중', '입고 완료'
);
create type ship_mode as enum ('SEA', 'AIR', 'DHL');
create type shipment_kind as enum ('Product', 'Sample');
create type record_location as enum ('active', 'archived', 'trashed');

-- ───────────── 예외 상태 목록 ─────────────
create table exception_types (
  id          bigint generated always as identity primary key,
  name        text not null unique check (btrim(name) <> ''),
  is_default  boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now()
);
insert into exception_types (name, is_default) values ('On Hold', true), ('Cancelled', true);

-- ───────────── Shipment ─────────────
create table shipments (
  id                  uuid primary key default gen_random_uuid(),
  shipment_no         text not null check (btrim(shipment_no) <> ''),  -- 중복 허용(화면에서 경고만)
  origin_country      text,
  ship_mode           ship_mode,
  shipment_type       shipment_kind,
  seasons             text[] not null default '{}',
  cartons             integer check (cartons >= 0),
  pcs                 integer check (pcs >= 0),
  content             text,
  etd                 date,
  eta                 date,
  status              ship_status not null default '선적 예정',
  exception_id        bigint references exception_types (id),
  bl_awb_no           text,
  remark              text,
  mail_links          text[] not null default '{}',
  delay_confirmed     boolean not null default false,
  delay_reason        text,
  delay_confirmed_at  timestamptz,
  delay_stage         text check (delay_stage in ('ETD', 'ETA')),   -- 어느 일정이 지연됐는지 (해제 제안용)
  priority            smallint not null default 0 check (priority between 0 and 2),   -- 중요도: 0 없음, 1 중요, 2 긴급
  inbound_date        date,
  logistics_eta       date,   -- 물류 예상 입고일(일양 스케쥴 대체)
  location            record_location not null default 'active',
  created_by          text not null check (btrim(created_by) <> ''),
  created_at          timestamptz not null default now(),
  updated_by          text not null,
  updated_at          timestamptz not null default now(),
  -- 입고 완료는 입고일 필수, 지연 확정은 사유 필수
  constraint inbound_needs_date check (status <> '입고 완료' or inbound_date is not null),
  constraint delay_needs_reason check (not delay_confirmed or coalesce(btrim(delay_reason), '') <> '')
);
create index shipments_location_etd on shipments (location, etd);
create index shipments_seasons on shipments using gin (seasons);
create index shipments_no on shipments (shipment_no);

-- ───────────── 변경 이력 (추가만 가능) ─────────────
create table activity_log (
  id           bigint generated always as identity primary key,
  shipment_id  uuid,          -- FK 없음: 영구 삭제 후에도 이력 보존
  shipment_no  text,
  action       text not null check (action in (
                 'create', 'update', 'status_change', 'delay_confirm', 'delay_clear',
                 'inbound_complete', 'archive', 'trash', 'restore', 'purge', 'exception_type_add')),
  field        text,
  old_value    text,
  new_value    text,
  actor        text,
  snapshot     jsonb,         -- 영구 삭제 시 삭제 직전 전체 값
  created_at   timestamptz not null default now()
);
create index activity_log_created on activity_log (created_at desc);
create index activity_log_shipment on activity_log (shipment_id);

-- ───────────── 접속 코드 (내부 전용) ─────────────
create table app_secret (
  id         int primary key default 1 check (id = 1),
  salt       text not null,
  code_hash  text not null
);
create table members (
  user_id    uuid primary key,
  joined_at  timestamptz not null default now()
);
create table join_attempts (
  user_id    uuid not null,
  at         timestamptz not null default now()
);

create function code_hash(p_salt text, p_code text) returns text
language sql immutable as $$ select encode(sha256(convert_to(p_salt || p_code, 'UTF8')), 'hex') $$;

create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid())
$$;

-- 웹 화면에서 호출: 코드가 맞으면 이 브라우저(익명 사용자)를 팀원으로 등록
create function join_team(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s app_secret;
begin
  if auth.uid() is null then return false; end if;
  if is_member() then return true; end if;
  -- ponytail: 사용자당 10분에 5회 제한. 익명 계정 생성 자체는 Supabase 기본 rate limit 에 맡김
  if (select count(*) from join_attempts where user_id = auth.uid() and at > now() - interval '10 minutes') >= 5 then
    return false;
  end if;
  select * into s from app_secret where id = 1;
  if s is null or code_hash(s.salt, p_code) <> s.code_hash then
    insert into join_attempts (user_id) values (auth.uid());
    return false;
  end if;
  insert into members (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end $$;

-- SQL Editor 에서만 실행: select set_access_code('새 코드');
-- 코드를 바꾸면 기존 팀원 등록이 모두 풀려서 모두 새 코드를 다시 입력해야 합니다.
create function set_access_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_salt text := md5(random()::text || clock_timestamp()::text);
begin
  if length(coalesce(p_code, '')) < 8 then raise exception '접속 코드는 8자 이상이어야 합니다'; end if;
  insert into app_secret (id, salt, code_hash) values (1, v_salt, code_hash(v_salt, p_code))
    on conflict (id) do update set salt = excluded.salt, code_hash = excluded.code_hash;
  delete from members;
  delete from join_attempts;
end $$;

-- ───────────── 트리거: 자동 값 + 이력 기록 ─────────────
create function shipments_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_by := new.created_by;
  end if;
  new.updated_at := now();
  if new.delay_confirmed and (tg_op = 'INSERT' or not old.delay_confirmed) then
    new.delay_confirmed_at := now();
  elsif not new.delay_confirmed then
    new.delay_confirmed_at := null;
  end if;
  return new;
end $$;

create trigger shipments_before before insert or update on shipments
for each row execute function shipments_before();

create function exception_name(p_id text) returns text
language sql stable as $$ select name from exception_types where id = p_id::bigint $$;

create function shipments_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; k text; ov text; nv text; act text;
  skip text[] := array['updated_at', 'updated_by', 'created_at', 'created_by', 'delay_confirmed_at'];
begin
  if tg_op = 'INSERT' then
    insert into activity_log (shipment_id, shipment_no, action, actor)
      values (new.id, new.shipment_no, 'create', new.created_by);
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into activity_log (shipment_id, shipment_no, action, actor, snapshot)
      values (old.id, old.shipment_no, 'purge', nullif(current_setting('app.actor', true), ''), to_jsonb(old));
    return null;
  end if;

  o := to_jsonb(old); n := to_jsonb(new);
  for k in select jsonb_object_keys(n) loop
    continue when k = any (skip) or (o -> k) is not distinct from (n -> k);
    ov := o ->> k; nv := n ->> k;
    act := case
      when k = 'location' then case nv when 'archived' then 'archive' when 'trashed' then 'trash' else 'restore' end
      when k = 'status' and nv = '입고 완료' then 'inbound_complete'
      when k = 'status' then 'status_change'
      when k = 'delay_confirmed' then case when nv = 'true' then 'delay_confirm' else 'delay_clear' end
      else 'update' end;
    if k = 'exception_id' then ov := exception_name(ov); nv := exception_name(nv); end if;
    insert into activity_log (shipment_id, shipment_no, action, field, old_value, new_value, actor)
      values (new.id, new.shipment_no, act, k, ov, nv, new.updated_by);
  end loop;
  return null;
end $$;

create trigger shipments_log after insert or update or delete on shipments
for each row execute function shipments_log();

create function exception_types_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity_log (action, new_value, actor) values ('exception_type_add', new.name, new.created_by);
  return null;
end $$;

create trigger exception_types_log after insert on exception_types
for each row when (not new.is_default) execute function exception_types_log();

-- ───────────── RPC: 셀 수정 (충돌 확인) ─────────────
-- p_expected: 편집 시작 시점 값 {필드: 값}, p_new: 새 값 {필드: 값}
-- 반환: {status:'ok', row} | {status:'conflict', field, current, by, at} | {status:'not_found'}
create function update_shipment(p_id uuid, p_expected jsonb, p_new jsonb, p_actor text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  allowed text[] := array['shipment_no', 'origin_country', 'ship_mode', 'shipment_type', 'seasons', 'cartons',
    'pcs', 'content', 'etd', 'eta', 'status', 'exception_id', 'bl_awb_no', 'remark', 'mail_links',
    'delay_confirmed', 'delay_reason', 'delay_stage', 'inbound_date', 'location', 'priority', 'logistics_eta'];
  cur jsonb; k text; sets text := '';
begin
  if not is_member() then raise exception 'not a member' using errcode = '42501'; end if;
  if coalesce(btrim(p_actor), '') = '' then raise exception '수정자 이름이 필요합니다'; end if;

  select to_jsonb(s) into cur from shipments s where id = p_id for update;
  if cur is null then return jsonb_build_object('status', 'not_found'); end if;

  for k in select jsonb_object_keys(p_new) loop
    if not k = any (allowed) then raise exception '수정할 수 없는 필드: %', k; end if;
    if not p_expected ? k then raise exception '편집 전 값이 없습니다: %', k; end if;
    if (cur -> k) is distinct from (p_expected -> k) then
      return jsonb_build_object('status', 'conflict', 'field', k, 'current', cur -> k,
                                'by', cur ->> 'updated_by', 'at', cur ->> 'updated_at');
    end if;
    sets := sets || format('%I = (x.r).%I, ', k, k);
  end loop;
  if sets = '' then return jsonb_build_object('status', 'ok', 'row', cur); end if;

  execute format('update shipments s set %s updated_by = $2 from (select jsonb_populate_record(null::shipments, $1) r) x where s.id = $3',
                 sets) using p_new, p_actor, p_id;
  select to_jsonb(s) into cur from shipments s where id = p_id;
  return jsonb_build_object('status', 'ok', 'row', cur);
end $$;

-- ───────────── RPC: 영구 삭제 (Trash 에 있는 것만) ─────────────
create function purge_shipment(p_id uuid, p_actor text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'not a member' using errcode = '42501'; end if;
  perform set_config('app.actor', p_actor, true);
  delete from shipments where id = p_id and location = 'trashed';
  return found;
end $$;

-- ───────────── 권한 ─────────────
alter table shipments       enable row level security;
alter table exception_types enable row level security;
alter table activity_log    enable row level security;
alter table app_secret      enable row level security;
alter table members         enable row level security;
alter table join_attempts   enable row level security;

revoke all on shipments, exception_types, activity_log, app_secret, members, join_attempts from anon, authenticated;
grant select, insert on shipments, exception_types to authenticated;
grant select on activity_log to authenticated;

create policy member_read   on shipments       for select to authenticated using (is_member());
create policy member_insert on shipments       for insert to authenticated with check (is_member() and location = 'active');
create policy member_read   on exception_types for select to authenticated using (is_member());
create policy member_insert on exception_types for insert to authenticated with check (is_member() and not is_default);
create policy member_read   on activity_log    for select to authenticated using (is_member());

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function is_member(), join_team(text), update_shipment(uuid, jsonb, jsonb, text),
  purge_shipment(uuid, text) to authenticated;

-- ───────────── 실시간 ─────────────
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table shipments, exception_types, activity_log;
  end if;
end $$;
