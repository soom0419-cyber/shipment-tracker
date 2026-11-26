-- 007: 물류 예상 입고일 자동 입력 = 도착 예정일 + 5일. SQL Editor 에서 한 번 실행합니다.
-- 사용자가 직접 고친 값(ETA+5와 다른 값)은 ETA가 바뀌어도 덮어쓰지 않습니다.
create or replace function shipments_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_by := new.created_by;
    -- 물류 예상 입고일 기본값 = 도착 예정일 + 5일
    if new.logistics_eta is null and new.eta is not null then new.logistics_eta := new.eta + 5; end if;
  elsif new.eta is not null and new.eta is distinct from old.eta
        and new.logistics_eta is not distinct from old.logistics_eta          -- 이번 수정에서 물류 예상 입고일을 직접 바꾸지 않았고
        and (new.logistics_eta is null or (old.eta is not null and new.logistics_eta = old.eta + 5)) then  -- 비어 있거나 자동값(옛 ETA+5) 그대로일 때만 따라감
    new.logistics_eta := new.eta + 5;
  end if;
  new.updated_at := now();
  if new.delay_confirmed and (tg_op = 'INSERT' or not old.delay_confirmed) then
    new.delay_confirmed_at := now();
  elsif not new.delay_confirmed then
    new.delay_confirmed_at := null;
  end if;
  return new;
end $$;

-- 기존 행 채우기: ETA는 있는데 물류 예상 입고일이 빈 행(휴지통 제외). 이력·수정 시각은 건드리지 않도록 트리거를 잠시 끕니다.
alter table shipments disable trigger shipments_before;
alter table shipments disable trigger shipments_log;
update shipments set logistics_eta = eta + 5 where logistics_eta is null and eta is not null and location <> 'trashed';
alter table shipments enable trigger shipments_before;
alter table shipments enable trigger shipments_log;
select shipment_no, eta, logistics_eta from shipments where location <> 'trashed' order by shipment_no;
