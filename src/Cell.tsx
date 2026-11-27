import { useEffect, useRef, useState } from 'react';
import type { Col } from './columns';
import { LAST_STICKY, stickyLeft, exceptionName, fmtAgo, fmtDate, fmtInt, isUrl, parseInput, toInput } from './columns';
import type { Candidate } from './delay';
import { etaMissing } from './delay';
import { ko } from './ko';

const EXC_COL = { key: 'exception', label: '', width: 0, kind: 'readonly' } as Col;
import type { ExceptionType, Shipment, Status } from './types';

export type Save = (id: string, expected: Record<string, unknown>, next: Record<string, unknown>) => Promise<boolean>;

interface Props {
  col: Col;
  s: Shipment;
  ex: ExceptionType[];
  editing: boolean;
  canEdit: boolean;
  dupNo: boolean;
  onEdit: (on: boolean) => void;
  save: Save;
  onAddException: (name: string) => Promise<number | null>;
  row: RowCtx;
}

// 행 단위 작업 (지연·입고·제안). 실제 처리는 Tracker가 한다.
export type RowAction = 'delay' | 'advance' | 'clear' | 'dismiss-clear' | 'inbound' | 'accept-suggest' | 'dismiss-suggest'
  | 'archive' | 'trash' | 'restore' | 'purge';
export interface RowCtx {
  suggest: Suggestion | null; cand: Candidate | null; clearSug: boolean; act: (a: RowAction) => void; menu: boolean;
  setExc: (v: number | null | 'new') => void;
  setPri: (v: number) => void;
}

// 시스템이 제안하는 상태 변경 (사용자가 눌러야만 적용)
export interface Suggestion { to: Status; why: string }

// 상태 배지 색: 준비(회색) → 부킹 완료(보라) → 이동(파랑) → 입항(청록) → 입고(초록)
export const STATUS_TONE: Record<string, string> = {
  '선적 예정': 'gray', '부킹 대기': 'gray', '부킹 완료': 'violet',
  '운송 중': 'blue', '통관 중': 'teal', '입고 완료': 'green',
};

interface DisplayProps { col: Col; s: Shipment; ex: ExceptionType[]; dupNo: boolean; row: RowCtx }

const stop = (e: React.MouseEvent) => e.stopPropagation();

export function Display({ col, s, ex, dupNo, row }: DisplayProps) {
  const { suggest, cand, clearSug, act } = row;
  switch (col.key) {
    case 'shipment_no':
      return <>{(s.priority ?? 0) > 0 && <span className={`pri-tag p${s.priority}`}>{s.priority === 2 ? '긴급' : '중요'}</span>}{s.shipment_no}{dupNo && <span className="dup" title="같은 번호가 이미 있습니다"> ⚠</span>}</>;
    case 'status':
      return (
        <>
          <span className={`badge ${STATUS_TONE[s.status]}`}>{s.status}</span>
          <div className="flags"><Display col={EXC_COL} s={s} ex={ex} dupNo={false} row={row} /></div>
          {suggest && (
            <div className="suggest" onClick={stop} title={suggest.why}>
              <button className="link" onClick={() => act('accept-suggest')}>→ {suggest.to}?</button>
              <button className="link muted" aria-label="제안 닫기" onClick={() => act('dismiss-suggest')}>✕</button>
            </div>
          )}
        </>
      );
    case 'exception': {
      const n = exceptionName(s, ex);
      return (
        <>
          {s.delay_confirmed && <span className="badge red" title={s.delay_stage ? `${ko('delay_stage', s.delay_stage)} 지연` : ''}>지연</span>}{' '}
          {n && <span className={`badge ${n === 'Cancelled' ? 'outline' : 'amber'}`}>{ko('exception', n)}</span>}
          {cand && <span className="badge amber" title={`${cand.stage === 'ETD' ? '출항 예정일' : '도착 예정일'}이 지났는데 상태가 그대로입니다`}>{ko('delay_stage', cand.stage)} 지연 후보</span>}
          {s.delay_confirmed && <div className="sub" title={s.delay_reason ?? ''}>{s.delay_reason}</div>}
          {cand && (
            <div className="sub acts" onClick={stop}>
              <button className="link" onClick={() => act('advance')}>{cand.next}로 변경</button>
              <button className="link" onClick={() => act('delay')}>{s.delay_confirmed ? '지연 갱신' : '지연 확정'}</button>
            </div>
          )}
          {clearSug && !cand && (
            <div className="sub acts" onClick={stop}>
              <button className="link" onClick={() => act('clear')}>지연 해제?</button>
              <button className="link muted" aria-label="제안 닫기" onClick={() => act('dismiss-clear')}>✕</button>
            </div>
          )}
        </>
      );
    }
    case 'etd': return s.etd ? <span className={cand?.stage === 'ETD' ? 'warn-text' : ''}>{fmtDate(s.etd)}</span> : <span className="muted">미입력</span>;
    case 'eta': return s.eta ? <span className={cand?.stage === 'ETA' ? 'warn-text' : ''}>{fmtDate(s.eta)}</span>
      : etaMissing(s) ? <span className="warn-text">미입력</span> : null;
    case 'logistics_eta': return <>{fmtDate(s.logistics_eta)}</>;
    case 'inbound_date': return <>{fmtDate(s.inbound_date)}</>;
    case 'cartons': return <>{fmtInt(s.cartons)}</>;
    case 'pcs': return <>{fmtInt(s.pcs)}</>;
    case 'seasons': return <>{s.seasons.join(', ')}</>;
    case 'ship_mode': case 'shipment_type': return <>{ko(col.key, s[col.key])}</>;
    case 'remark': return <span className="pre">{s.remark}</span>;
    case 'updated': return <span className="muted small">{s.updated_by} · {fmtAgo(s.updated_at)}</span>;
    default: {
      const v = col.field ? s[col.field] : null;
      return <span className="clip" title={v == null ? '' : String(v)}>{v == null ? '' : String(v)}</span>;
    }
  }
}

export function Cell({ col, s, ex, editing, canEdit, dupNo, onEdit, save, onAddException, row }: Props) {
  const editable = Boolean(col.field) && canEdit;
  const cls = `${col.right ? 'r' : ''} ${editable ? 'editable' : ''} ${col.sticky ? 'sticky' : ''} ${col.key === LAST_STICKY ? 'sticky-last' : ''}`;
  const style = col.sticky ? { left: stickyLeft(col.key) } : undefined;

  if (col.kind === 'mail') return <td className={cls}><MailCell s={s} canEdit={canEdit} save={save} /></td>;
  if (col.kind === 'menu') return <td className="menu-cell">{row.menu && <RowMenu s={s} act={row.act} ex={ex} setExc={row.setExc} setPri={row.setPri} />}</td>;

  if (!editing || !editable) {
    return (
      <td className={cls} style={style} onClick={() => editable && onEdit(true)}>
        <Display col={col} s={s} ex={ex} dupNo={dupNo} row={row} />
      </td>
    );
  }
  return <td className={`${cls} editing`} style={style}><Editor col={col} s={s} ex={ex} onAddException={onAddException} onDone={() => onEdit(false)} save={save} act={row.act} /></td>;
}

interface EditorProps { col: Col; s: Shipment; ex: ExceptionType[]; onAddException: Props['onAddException']; onDone: () => void; save: Save; act: RowCtx['act'] }

function Editor({ col, s, ex, onAddException, onDone, save, act }: EditorProps) {
  const field = col.field!;
  const [expected] = useState(() => s[field]);            // 편집 시작 시점 값 (충돌 확인용)
  const [raw, setRaw] = useState(() => toInput(col, s));
  const [err, setErr] = useState('');
  const done = useRef(false);

  const commit = async (v = raw) => {
    if (done.current) return;
    const p = parseInput(col, v);
    if ('error' in p) return setErr(p.error);
    if (field === 'status' && p.value !== expected) {
      // 입고 완료로 바꾸는 건 입고일 확인 창을 거친다
      if (p.value === '입고 완료') { done.current = true; onDone(); act('inbound'); return; }
      // 완료 해제는 확인 후, 입고일도 함께 비운다
      if (expected === '입고 완료') {
        done.current = true; onDone();
        if (confirm(`입고 완료 상태를 '${p.value}'(으)로 바꾸면 입고 완료 목록에서 진행 중 목록으로 돌아갑니다. 바꿀까요?`)) {
          await save(s.id, { status: expected, inbound_date: s.inbound_date }, { status: p.value, inbound_date: null });
        }
        return;
      }
    }
    done.current = true;
    onDone();
    if (JSON.stringify(p.value) !== JSON.stringify(expected)) await save(s.id, { [field]: expected }, { [field]: p.value });
  };
  const cancel = () => { done.current = true; onDone(); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && (col.kind !== 'textarea' || e.ctrlKey || e.metaKey)) { e.preventDefault(); void commit(); }
  };
  const common = { autoFocus: true, value: raw, onBlur: () => void commit(), onKeyDown: keys,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setRaw(e.target.value); setErr(''); } };

  let input: React.ReactNode;
  if (col.kind === 'exception') {
    const pick = async (v: string) => {
      if (v !== '__new') return commit(v);
      done.current = true;
      onDone();
      const n = prompt('새 예외 상태 이름 (모든 팀원의 선택지에 추가됩니다)')?.trim();
      const id = n ? await onAddException(n) : null;
      if (id != null) await save(s.id, { exception_id: expected }, { exception_id: id });
    };
    input = (
      <select {...common} onChange={(e) => void pick(e.target.value)}>
        <option value="">—</option>
        {ex.map((o) => <option key={o.id} value={o.id}>{ko('exception', o.name)}</option>)}
        <option value="__new">+ 새 예외 상태…</option>
      </select>
    );
  } else if (col.kind === 'select') {
    const opts = col.options ?? [];
    input = (
      <select {...common} onChange={(e) => void commit(e.target.value)}>
        {!col.required && <option value="">—</option>}
        {opts.map((o) => <option key={o} value={o}>{ko(col.key, o)}</option>)}
      </select>
    );
  } else if (col.kind === 'textarea') {
    input = <textarea {...common} rows={Math.min(8, Math.max(3, raw.split('\n').length + 1))} placeholder="Ctrl+Enter로 저장" />;
  } else {
    input = <input {...common} type={col.kind === 'date' ? 'date' : 'text'} inputMode={col.kind === 'int' ? 'numeric' : undefined}
      placeholder={col.kind === 'seasons' ? 'AW27, R28' : ''} />;
  }
  return <>{input}{err && <div className="cell-err">{err}</div>}</>;
}

function MailCell({ s, canEdit, save }: { s: Shipment; canEdit: boolean; save: Save }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const add = async () => {
    if (!isUrl(url)) return setErr('http:// 또는 https:// 로 시작하는 주소를 입력하세요');
    if (await save(s.id, { mail_links: s.mail_links }, { mail_links: [...s.mail_links, url.trim()] })) setUrl('');
  };
  const remove = (i: number) => save(s.id, { mail_links: s.mail_links }, { mail_links: s.mail_links.filter((_, j) => j !== i) });

  return (
    <div className="mail" ref={box}>
      {s.mail_links.length || canEdit
        ? <button className="mini" onClick={() => setOpen(!open)}>{s.mail_links.length ? `메일 체인 · ${s.mail_links.length}` : '+ 추가'}</button>
        : null}
      {open && (
        <div className="pop">
          {s.mail_links.map((u, i) => (
            <div key={i} className="pop-row">
              <a href={u} target="_blank" rel="noreferrer noopener" title={u}>메일 체인 {i + 1}</a>
              <span className="muted small clip">{u}</span>
              {canEdit && <button className="ghost" aria-label="삭제" onClick={() => void remove(i)}>✕</button>}
            </div>
          ))}
          {canEdit && (
            <div className="pop-row">
              <input value={url} placeholder="https://..." onChange={(e) => { setUrl(e.target.value); setErr(''); }}
                onKeyDown={(e) => e.key === 'Enter' && void add()} />
              <button className="mini" onClick={() => void add()}>추가</button>
            </div>
          )}
          {err && <div className="cell-err">{err}</div>}
        </div>
      )}
    </div>
  );
}

function RowMenu({ s, act, ex, setExc, setPri }: { s: Shipment; act: RowCtx['act']; ex: ExceptionType[]; setExc: RowCtx['setExc']; setPri: RowCtx['setPri'] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = (label: string, a: RowAction) => <button className="ghost" onClick={() => { setOpen(false); act(a); }}>{label}</button>;
  return (
    <div className="mail" ref={box}>
      <button className="ghost mini" aria-label="행 메뉴" onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="pop menu">
          {s.location === 'active' && <>
            {([[2, '🔴 중요도: 긴급'], [1, '🟡 중요도: 중요'], [0, '중요도 해제']] as const)
              .filter(([v]) => v !== (s.priority ?? 0))
              .map(([v, label]) => <button key={v} className="ghost" onClick={() => { setOpen(false); setPri(v); }}>{label}</button>)}
            <hr />
            {item(s.delay_confirmed ? '지연 수정' : '지연 등록', 'delay')}
            {s.delay_confirmed && item('지연 해제', 'clear')}
            {s.status !== '입고 완료' && item('입고 완료 처리', 'inbound')}
            <hr />
            {ex.filter((e) => e.id !== s.exception_id).map((e) => (
              <button key={e.id} className="ghost" onClick={() => { setOpen(false); setExc(e.id); }}>예외 상태: {ko('exception', e.name)}</button>
            ))}
            {s.exception_id != null && <button className="ghost" onClick={() => { setOpen(false); setExc(null); }}>예외 상태 해제</button>}
            <button className="ghost" onClick={() => { setOpen(false); setExc('new'); }}>+ 새 예외 상태…</button>
            <hr />
            {item('보관함으로 이동', 'archive')}
          </>}
          {s.location !== 'active' && item('복구', 'restore')}
          {s.location !== 'trashed' && item('삭제 (휴지통으로 이동)', 'trash')}
          {s.location === 'trashed' && <button className="ghost danger-text" onClick={() => { setOpen(false); act('purge'); }}>영구 삭제…</button>}
        </div>
      )}
    </div>
  );
}
