-- 008: 물동량 집계 저장 테이블 + 쓰기 전용 토큰 RPC. SQL Editor 에서 한 번 실행합니다. 이어서 쓰기 토큰 등록 SQL도 실행해야 갱신됩니다.
-- 물동량(주간 입고 캘린더): 대시보드 빌드가 계산한 집계 문서 1건을 올려 두고 앱이 읽습니다. 쓰기 전용 토큰으로만 갱신 가능.
alter table read_tokens add column if not exists can_write boolean not null default false;

create table if not exists volume_schedule (
  id         int primary key check (id = 1),
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
alter table volume_schedule enable row level security;
revoke all on volume_schedule from anon, authenticated;
grant select on volume_schedule to authenticated;
drop policy if exists member_read on volume_schedule;
create policy member_read on volume_schedule for select to authenticated using (is_member());

create or replace function put_volume_schedule(p_token text, p_doc jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from read_tokens where can_write
                 and token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')) then
    raise exception 'invalid token' using errcode = '42501';
  end if;
  insert into volume_schedule (id, doc, updated_at) values (1, p_doc, now())
  on conflict (id) do update set doc = excluded.doc, updated_at = now();
end $$;
revoke execute on function put_volume_schedule(text, jsonb) from public;
grant execute on function put_volume_schedule(text, jsonb) to anon, authenticated;
