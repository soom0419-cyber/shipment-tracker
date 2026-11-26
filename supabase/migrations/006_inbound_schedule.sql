-- 006: 대시보드용 읽기 전용 선적 일정 조회(토큰 방식). SQL Editor 에서 한 번 실행합니다. 이어서 토큰 등록 SQL도 실행해야 동작합니다.
-- 읽기 전용 조회 토큰: 대시보드 빌드 스크립트가 선적 일정만 읽어 가는 창구. 토큰 평문은 DB에 두지 않고 해시만 저장합니다.
create table if not exists read_tokens (
  token_hash text primary key,
  label      text not null,
  created_at timestamptz not null default now()
);
alter table read_tokens enable row level security;
revoke all on read_tokens from anon, authenticated;

create or replace function inbound_schedule(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from read_tokens where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')) then
    raise exception 'invalid token' using errcode = '42501';
  end if;
  -- 휴지통(trashed)은 제외. 읽기만 하며 필요한 칸만 돌려줍니다.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'shipment_no', shipment_no, 'seasons', seasons, 'shipment_type', shipment_type, 'status', status,
      'ship_mode', ship_mode, 'origin_country', origin_country, 'bl_awb_no', bl_awb_no,
      'etd', etd, 'eta', eta, 'logistics_eta', logistics_eta, 'inbound_date', inbound_date,
      'cartons', cartons, 'pcs', pcs, 'delay_confirmed', delay_confirmed, 'location', location)
      order by shipment_no)
    from shipments where location in ('active', 'archived')), '[]'::jsonb);
end $$;
revoke execute on function inbound_schedule(text) from public;
grant execute on function inbound_schedule(text) to anon, authenticated;
