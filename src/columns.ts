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
  { key: 'shipment_no', label: '선적 번호', width: 100, kind: 'text', field: 'shipment_no', required: true, sticky: true },
  { key: 'bl_awb_no', label: 'BL·AWB 번호', width: 112, kind: 'text', field: 'bl_awb_no', sticky: true },
  { key: 'ship_mode', label: '운송 방식', width: 66, kind: 'select', field: 'ship_mode', options: SHIP_MODES, sticky: true },
  { key: 'origin_country', label: '출발 국가', width: 78, kind: 'text', field: 'origin_country', sticky: true },
  { key: 'status', label: '진행 상태', width: 120, kind: 'select', field: 'status', options: STATUSES, required: true, sticky: true },
  { key: 'shipment_type', label: '구분', width: 54, kind: 'select', field: 'shipment_type', options: ['Product', 'Sample'] },
  { key: 'seasons', label: '시즌', width: 80, kind: 'seasons', field: 'seasons' },
  { key: 'etd', label: '출항 예정일', width: 90, kind: 'date', field: 'etd' },
  { key: 'eta', label: '도착 예정일', width: 90, kind: 'date', field: 'eta' },
  { key: 'cartons', label: '카톤', width: 58, kind: 'int', field: 'cartons', right: true },
  { key: 'pcs', label: '수량(PCS)', width: 74, kind: 'int', field: 'pcs', right: true },
  { key: 'booking', label: '부킹', width: 54, kind: 'readonly' },
  { key: 'mail_links', label: '메일 체인', width: 94, kind: 'mail', field: 'mail_links' },
  { key: 'remark', label: '비고', width: 140, kind: 'textarea', field: 'remark' },
  { key: 'updated', label: '최종 수정', width: 100, kind: 'readonly' },
  { key: 'menu', label: '', width: 32, kind: 'menu' },
];

export const LAST_STICKY = 'status';
// 고정 컬럼 left 위치
// 고정 컬럼 left 위치 / 칸 폭은 CSS 변수(--l-키, --w-키)로 주고, 표 너비에 맞춰 Tracker가 값을 바꾼다
export const stickyLeft = (key: string) => `var(--l-${key})`;
export const colWidth = (key: string) => `var(--w-${key})`;
const TOTAL_W = COLUMNS.reduce((n, c) => n + c.width, 0);
const MIN_SCALE = 0.6;   // 이보다 좁아지면(약 820px 미만) 줄이지 않고 가로 스크롤

// 표 영역 너비 → 칸별 폭·고정 칸 위치 (기본 폭 비율 유지, 버림으로 합계가 넘치지 않게)
export function colVars(areaWidth: number): Record<string, string> {
  const scale = Math.max(MIN_SCALE, areaWidth / TOTAL_W);
  // 좁은 화면에서는 글자도 조금 작게 (13px → 최소 11px)
  const v: Record<string, string> = { '--fs': `${Math.max(11, Math.min(13, Math.round(13 * scale)))}px` };
  let left = 0, total = 0;
  for (const c of COLUMNS) {
    const w = Math.floor(c.width * scale);
    v[`--w-${c.key}`] = `${w}px`;
    if (c.sticky) { v[`--l-${c.key}`] = `${left}px`; left += w; }
    total += w;
  }
  v['--tw'] = `${total}px`;   // 표 전체 너비 = 칸 폭 합계 (내용 때문에 넓어지지 않게)
  return v;
}

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
