import { useEffect, useRef, useState } from 'react';
import { COLUMNS, fmtDate } from './columns';
import { ko } from './ko';
import type { Activity } from './types';

const ACTION: Record<string, string> = {
  create: '신규 등록', update: '수정', status_change: '상태 변경', delay_confirm: '지연 확정', delay_clear: '지연 해제',
  inbound_complete: '창고 입고 완료', archive: '보관함으로 이동', trash: '휴지통으로 이동', restore: '복구', purge: '영구 삭제',
  exception_type_add: '예외 상태 추가',
};
const FIELD: Record<string, string> = {
  ...Object.fromEntries(COLUMNS.filter((c) => c.field).map((c) => [c.field!, c.label])),
  exception_id: '예외 상태', delay_confirmed: '지연', delay_reason: '지연 사유', delay_stage: '지연 구분',
  inbound_date: '입고일', location: '위치',
};
// 알림 대상: 신규 등록, 상태 변경, 지연 확정, 입고 완료
export const NOTIFY = new Set(['create', 'status_change', 'delay_confirm', 'inbound_complete']);

export const fmtTime = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
};

function fmtValue(field: string | null, v: string | null) {
  if (v == null || v === '') return '(빈 값)';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (field === 'mail_links') { try { const n = (JSON.parse(v) as string[]).length; return n ? `링크 ${n}개` : '(빈 값)'; } catch { /* 그대로 */ } }
  if (v.startsWith('[')) { try { return (JSON.parse(v) as string[]).join(', ') || '(빈 값)'; } catch { /* 그대로 */ } }
  if (field === 'ship_mode' || field === 'shipment_type' || field === 'delay_stage') return ko(field, v);
  if (field === 'exception_id') return ko('exception', v);
  if (field === 'delay_confirmed') return v === 'true' ? '지연' : '해제';
  if (field === 'location') return ({ active: '목록', archived: '보관함', trashed: '휴지통' } as Record<string, string>)[v] ?? v;
  return v;
}

// "무엇을 했는지" 한 줄
export function describe(a: Activity) {
  const act = ACTION[a.action] ?? a.action;
  if (a.action === 'create' || a.action === 'purge' || a.action === 'exception_type_add') return `${act}${a.new_value ? ` · ${a.new_value}` : ''}`;
  if (a.action === 'delay_confirm' || a.action === 'delay_clear' || a.action === 'archive' || a.action === 'trash' || a.action === 'restore') return act;
  const f = a.field ? FIELD[a.field] ?? a.field : '';
  return `${act === '수정' ? '' : `${act} · `}${f}: ${fmtValue(a.field, a.old_value)} → ${fmtValue(a.field, a.new_value)}`;
}

export function ActivityList({ items, onOpen, compact }: { items: Activity[]; onOpen: (a: Activity) => void; compact?: boolean }) {
  if (!items.length) return <p className="muted small">아직 변경 이력이 없습니다.</p>;
  return (
    <table className={`acts-table ${compact ? 'compact' : ''}`}>
      <tbody>
        {items.map((a) => (
          <tr key={a.id}>
            <td className="when">{fmtTime(a.created_at)}</td>
            <td className="who">{a.actor ?? '—'}</td>
            <td className="no">{a.shipment_no ? <button className="link" onClick={() => onOpen(a)}>{a.shipment_no}</button> : '—'}</td>
            <td className="what">{describe(a)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const SEEN_KEY = 'st-notif-seen';
const readSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY) ?? 0); } catch { return 0; } };

// 알림: 다른 사람이 한 주요 작업만. 읽음 위치는 이 브라우저에 저장.
export function Bell({ items, me, onOpen }: { items: Activity[]; me: string; onOpen: (a: Activity) => void }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const box = useRef<HTMLDivElement>(null);
  const list = items.filter((a) => NOTIFY.has(a.action) && a.actor !== me).slice(0, 30);
  const unread = list.filter((a) => a.id > seen).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    if (!open && list[0]) {
      try { localStorage.setItem(SEEN_KEY, String(list[0].id)); } catch { /* 무시 */ }
      setTimeout(() => setSeen(list[0].id), 3000);   // 열어 둔 동안은 새 알림 표시 유지
    }
    setOpen(!open);
  };

  return (
    <div className="mail" ref={box}>
      <button className="ghost bell" aria-label={`알림 ${unread}개`} onClick={toggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="pop notif">
          {list.length === 0 && <p className="muted small">다른 팀원의 주요 변경이 아직 없습니다.</p>}
          {list.map((a) => (
            <button key={a.id} className={`ghost notif-item ${a.id > seen ? 'new' : ''}`} onClick={() => { setOpen(false); onOpen(a); }}>
              <b>{a.shipment_no}</b> {describe(a)}
              <span className="muted small">{a.actor} · {fmtTime(a.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
