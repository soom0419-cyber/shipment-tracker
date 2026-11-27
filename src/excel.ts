// Excel(.xlsx) 내보내기. 화면 컬럼 순서·표시 형식을 따르고, 이력은 넣지 않는다.
import { COLUMNS, exceptionName } from './columns';
import { fmtTime } from './Activity';
import { ko } from './ko';
import type { ExceptionType, Shipment } from './types';

const LOCATION = (s: Shipment) =>
  s.location === 'archived' ? '보관함' : s.location === 'trashed' ? '휴지통' : s.status === '입고 완료' ? '입고 완료' : '진행 중';

type CellV = string | number | Date | null;

// 날짜는 진짜 날짜 값(엑셀에서 정렬·필터 가능) + yyyy.mm.dd 표시
const toDate = (d: string | null) => { if (!d) return null; const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); };

function value(key: string, s: Shipment, ex: ExceptionType[]): CellV {
  switch (key) {
    case 'exception': {
      const parts = [s.delay_confirmed ? `지연${s.delay_reason ? ` (${s.delay_reason})` : ''}` : '', ko('exception', exceptionName(s, ex))];
      return parts.filter(Boolean).join(' / ') || null;
    }
    case 'status': { const x = value('exception', s, ex); return x ? `${s.status} / ${x}` : s.status; }
    case 'ship_mode': case 'shipment_type': return ko(key, s[key]) || null;
    case 'seasons': return s.seasons.join(', ') || null;
    case 'mail_links': return s.mail_links.join('\n') || null;
    case 'etd': case 'eta': case 'logistics_eta': case 'inbound_date': return toDate(s[key]);
    case 'updated': return `${s.updated_by} · ${fmtTime(s.updated_at)}`;
    default: {
      const v = s[key as keyof Shipment];
      return v == null ? null : (v as string | number);
    }
  }
}

const EXPORT_COLS = COLUMNS.filter((c) => c.kind !== 'menu');

export function buildSheetRows(list: Shipment[], ex: ExceptionType[], withLocation: boolean): CellV[][] {
  const head: CellV[] = EXPORT_COLS.map((c) => c.label);
  if (withLocation) head.push('목록');
  return [head, ...list.map((s) => {
    const r = EXPORT_COLS.map((c) => value(c.key, s, ex));
    if (withLocation) r.push(LOCATION(s));
    return r;
  })];
}

export async function downloadXlsx(list: Shipment[], ex: ExceptionType[], withLocation: boolean) {
  const XLSX = await import('xlsx');   // 처음 누를 때만 불러옴
  const rows = buildSheetRows(list, ex, withLocation);
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  // 표시 형식: 날짜 yyyy.mm.dd, 수량 천 단위 구분
  const D = 'yyyy"."mm"."dd';   // 점을 따옴표로 감싸야 엑셀이 날짜 형식으로 인식
  const fmt: Record<string, string> = { etd: D, eta: D, logistics_eta: D, inbound_date: D, cartons: '#,##0', pcs: '#,##0' };
  EXPORT_COLS.forEach((c, ci) => {
    if (!fmt[c.key]) return;
    for (let ri = 1; ri < rows.length; ri++) {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (cell) cell.z = fmt[c.key];
    }
  });
  ws['!cols'] = [...EXPORT_COLS.map((c) => ({ wch: Math.max(8, Math.round(c.width / 8)) })), ...(withLocation ? [{ wch: 10 }] : [])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '선적');
  const stamp = fmtTime(new Date().toISOString()).replace(/[.: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1_$2');
  XLSX.writeFile(wb, `선적목록_${stamp}.xlsx`);
}
