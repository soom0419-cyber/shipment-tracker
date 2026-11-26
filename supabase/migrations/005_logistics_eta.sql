-- 005: 물류 예상 입고일(logistics_eta) 컬럼 추가 + 셀 수정 함수에 허용
-- 기존 '일양 스케쥴' 시트의 '물류 예상 입고일'을 대체합니다. SQL Editor 에서 한 번 실행합니다.
alter table shipments add column if not exists logistics_eta date;

create or replace function update_shipment(p_id uuid, p_expected jsonb, p_new jsonb, p_actor text) returns jsonb
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
