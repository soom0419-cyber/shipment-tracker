export const STATUSES = [
  '선적 예정', '부킹 대기', '부킹 완료', '운송 중', '통관 중', '입고 완료',
] as const;
export type Status = (typeof STATUSES)[number];
export const SHIP_MODES = ['SEA', 'AIR', 'DHL'] as const;
export type ShipMode = (typeof SHIP_MODES)[number];
export type ShipmentType = 'Product' | 'Sample';
export type Location = 'active' | 'archived' | 'trashed';

// DB shipments 행 그대로 (날짜는 'YYYY-MM-DD' 문자열)
export interface Shipment {
  id: string;
  shipment_no: string;
  origin_country: string | null;
  ship_mode: ShipMode | null;
  shipment_type: ShipmentType | null;
  seasons: string[];
  cartons: number | null;
  pcs: number | null;
  content: string | null;
  etd: string | null;
  eta: string | null;
  status: Status;
  exception_id: number | null;
  bl_awb_no: string | null;
  remark: string | null;
  mail_links: string[];
  delay_confirmed: boolean;
  delay_reason: string | null;
  delay_confirmed_at: string | null;
  delay_stage: 'ETD' | 'ETA' | null;
  priority?: number;   // 0 없음, 1 중요, 2 긴급
  inbound_date: string | null;
  logistics_eta: string | null;   // 물류 예상 입고일
  location: Location;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

// 화면에서 수정 가능한 필드
export type EditableField = Exclude<keyof Shipment,
  'id' | 'created_by' | 'created_at' | 'updated_by' | 'updated_at' | 'delay_confirmed_at'>;
export type ShipmentInput = Partial<Pick<Shipment, EditableField>> & { shipment_no: string };

export interface ExceptionType { id: number; name: string; is_default: boolean }

export interface Activity {
  id: number;
  shipment_id: string | null;
  shipment_no: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string | null;
  created_at: string;
}

export type UpdateResult =
  | { status: 'ok'; row: Shipment }
  | { status: 'conflict'; field: EditableField; current: unknown; by: string; at: string }
  | { status: 'not_found' };
