import type { EditableField, ExceptionType, Shipment } from './types';
import { SHIP_MODES, STATUSES } from './types';

export type Kind = 'text' | 'int' | 'date' | 'select' | 'exception' | 'seasons' | 'textarea' | 'mail' | 'menu' | 'readonly';

export interface Col {
  key: string;
  label: string;
  width: number;
  kind: Kind;
  field?: EditableField;           // 수정 가능한 컬럼이면 DB 필드
  options?: readonly string[];     // select 선택지
  required?: boolean;
  sticky?: boolean;
  right?: boolean;
}

// 컬럼 순서 = 화면·Excel 순서 (확정: 고정 5개 + 스크롤 영역)
export const COLUMNS: Col[] = [
  { key: 'shipment_no', label: 'Shipment 번호', width: 140, kind: 'text', field: 'shipment_no', required: true, sticky: true },
  { key: 'bl_awb_no', label: 'BL / AWB', width: 160, kind: 'text', field: 'bl_awb_no', sticky: true },
  { key: 'ship_mode', label: 'SHIP MODE', width: 100, kind: 'select', field: 'ship_mode', options: SHIP_MODES, sticky: true },
  { key: 'origin_country', label: '출발 국가', width: 110, kind: 'text', field: 'origin_country', sticky: true },
  { key: 'status', label: '진행 상태', width: 128, kind: 'select', field: 'status', options: STATUSES, required: true, sticky: true },
  { key: 'exception', label: '예외 / 지연', width: 160, kind: 'exception', field: 'exception_id' },
  { key: 'shipment_type', label: 'Type', width: 100, kind: 'select', field: 'shipment_type', options: ['Product', 'Sample'] },
  { key: 'seasons', label: 'Season', width: 130, kind: 'seasons', field: 'seasons' },
  { key: 'etd', label: 'ETD', width: 124, kind: 'date', field: 'etd' },
  { key: 'eta', label: 'ETA', width: 124, kind: 'date', field: 'eta' },
  { key: 'cartons', label: 'Carton', width: 90, kind: 'int', field: 'cartons', right: true },
  { key: 'pcs', label: 'PCS', width: 100, kind: 'int', field: 'pcs', right: true },
  { key: 'booking', label: 'Booking', width: 90, kind: 'readonly' },
  { key: 'content', label: 'Shipment Content', width: 200, kind: 'text', field: 'content' },
  { key: 'mail_links', label: '메일 체인', width: 140, kind: 'mail', field: 'mail_links' },
  { key: 'remark', label: 'Remark', width: 220, kind: 'textarea', field: 'remark' },
  { key: 'inbound_date', label: '입고일', width: 110, kind: 'readonly' },
  { key: 'updated', label: '최종 수정', width: 150, kind: 'readonly' },
  { key: 'menu', label: '', width: 48, kind: 'menu' },
];

export const LAST_STICKY = 'status';
// 고정 컬럼 left 위치
export const STICKY_LEFT: Record<string, number> = {};
COLUMNS.reduce((left, c) => (c.sticky ? ((STICKY_LEFT[c.key] = left), left + c.width) : left), 0);

// ── 표시 형식 ──
export const fmtDate = (d: string | null) => (d ? d.replaceAll('-', '.') : '');
export const fmtInt = (n: number | null) => (n == null ? '' : n.toLocaleString('en-US'));
export const bookingOf = (s: Shipment) => (STATUSES.indexOf(s.status) >= 2 ? '완료' : '대기');

export function fmtAgo(iso: string, now = Date.now()) {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

// 셀 값 → 입력창 문자열
export function toInput(col: Col, s: Partial<Shipment>): string {
  const v = col.field ? s[col.field] : null;
  if (v == null) return '';
  if (col.kind === 'seasons') return (v as string[]).join(', ');
  return String(v);
}

// 입력창 문자열 → DB 값. 잘못된 값이면 { error }
export function parseInput(col: Col, raw: string): { value: unknown } | { error: string } {
  const t = raw.trim();
  switch (col.kind) {
    case 'int': {
      if (t === '') return { value: null };
      const n = t.replaceAll(',', '');
      if (!/^\d+$/.test(n)) return { error: '0 이상의 정수만 입력할 수 있습니다' };
      return { value: Number(n) };
    }
    case 'exception':
      return { value: t === '' ? null : Number(t) };
    case 'seasons':
      return { value: [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))] };
    case 'date':
      if (t === '') return { value: null };
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? { value: t } : { error: '날짜 형식이 올바르지 않습니다' };
    case 'textarea':
      return { value: raw.trim() === '' ? null : raw };
    default:
      if (t === '') return col.required ? { error: `${col.label}은(는) 비울 수 없습니다` } : { value: null };
      return { value: t };
  }
}

export const isUrl = (u: string) => /^https?:\/\/\S+$/i.test(u.trim());

export const exceptionName = (s: Shipment, ex: ExceptionType[]) =>
  ex.find((e) => e.id === s.exception_id)?.name ?? null;
