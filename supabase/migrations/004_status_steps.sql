-- 004: 진행 단계 변경 (7단계 → 6단계)
--   선적 예정 / 부킹 대기 / 부킹 완료 / 운송 중 / 통관 중 / 입고 완료
-- 기존 데이터 변환: 선적 완료 → 운송 중, 입항 완료 → 통관 중, 창고 입고 완료 → 입고 완료
-- 앱 배포와 같은 시점에 SQL Editor 에서 한 번 실행합니다. 전체가 한 묶음이라 중간에 실패하면 아무것도 바뀌지 않습니다.
begin;

-- 1) 실제로 단계가 바뀌는 건(선적 완료·입항 완료)은 변경 이력에 남김 (입고 완료는 이름만 바뀜)
insert into activity_log (shipment_id, shipment_no, action, field, old_value, new_value, actor)
select id, shipment_no, 'status_change', 'status', status::text,
       case status::text when '선적 완료' then '운송 중' else '통관 중' end, '시스템(단계 체계 변경)'
from shipments where status::text in ('선적 완료', '입항 완료');

-- 2) 새 단계 목록으로 교체
alter table shipments drop constraint if exists inbound_needs_date;
alter table shipments alter column status drop default;
create type ship_status_v2 as enum ('선적 예정', '부킹 대기', '부킹 완료', '운송 중', '통관 중', '입고 완료');
alter table shipments alter column status type ship_status_v2 using (case status::text
  when '선적 완료' then '운송 중' when '입항 완료' then '통관 중' when '창고 입고 완료' then '입고 완료'
  else status::text end)::ship_status_v2;
drop type ship_status;
alter type ship_status_v2 rename to ship_status;
alter table shipments alter column status set default '선적 예정';
alter table shipments add constraint inbound_needs_date check (status <> '입고 완료' or inbound_date is not null);

-- 3) 입고 완료 알림 판별에 새 이름 사용
create or replace function shipments_log() returns trigger
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

-- 4) 결과 확인
select status, count(*) from shipments group by status order by status;

commit;
