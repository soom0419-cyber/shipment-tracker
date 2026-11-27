import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityList, Bell } from './Activity';
import { addExceptionType, createShipment, listActivity, listExceptionTypes, listShipments, purgeShipment, subscribe, updateShipment } from './api';
import { Cell, STATUS_TONE, type RowAction, type Save, type Suggestion } from './Cell';
import { candidateOf, clearSuggested, stageOfStatus, todayKST } from './delay';
import { DelayDialog, InboundDialog, PurgeDialog } from './Dialogs';
import { downloadXlsx } from './excel';
import { ko } from './ko';
import { COLUMNS, LAST_STICKY, colVars, colWidth, exceptionName, stickyLeft } from './columns';
import { NewRow, loadDraft } from './NewRow';
import type { Activity, ExceptionType, Shipment, ShipmentInput } from './types';
import { SHIP_MODES, STATUSES } from './types';

type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; msg: string; retry?: () => void };
interface Conflict { id: string; no: string; field: string; mine: unknown; theirs: unknown; by: string }
interface Filters {
  q: string; season: string; country: string; mode: string; status: string; type: string;
  etdFrom: string; etdTo: string; etaFrom: string; etaTo: string; delay: string; exc: string;
}
const NO_FILTER: Filters = { q: '', season: '', country: '', mode: '', status: '', type: '', etdFrom: '', etdTo: '', etaFrom: '', etaTo: '', delay: '', exc: '' };
type View = 'main' | 'completed' | 'archived' | 'trashed' | 'activity';
const DONE = '입고 완료';

// 상태 변경 제안: 데이터를 보고 다음 단계를 제안만 한다 (자동 변경 없음)
const suggestOf = (s: Shipment): Suggestion | null =>
  s.bl_awb_no && STATUSES.indexOf(s.status) < 3 ? { to: '운송 중', why: 'BL/AWB 번호가 입력되어 있습니다' } : null;

const DISMISS_KEY = 'st-dismissed';
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]'); } catch { return []; } };

const sortValue = (s: Shipment, key: string, ex: ExceptionType[]): string | number | null => {
  switch (key) {
    case 'status': return STATUSES.indexOf(s.status);
    case 'exception': return s.delay_confirmed ? '0' : exceptionName(s, ex);
    case 'seasons': return s.seasons.join(',') || null;
    case 'mail_links': return s.mail_links.length || null;
    case 'updated': return s.updated_at;
    default: {
      const v = s[key as keyof Shipment];
      return v == null || v === '' ? null : typeof v === 'string' ? v.toLowerCase() : (v as number);
    }
  }
};

const inRange = (d: string | null, from: string, to: string) =>
  (!from && !to) || (d != null && (!from || d >= from) && (!to || d <= to));

export function Tracker({ name, onRename }: { name: string; onRename: () => void }) {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [acts, setActs] = useState<Activity[]>([]);
  const [moreActs, setMoreActs] = useState(true);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [ex, setEx] = useState<ExceptionType[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [sort, setSort] = useState({ key: 'etd', asc: true });
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [editing, setEditing] = useState<string | null>(null);   // `${id}:${colKey}`
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [newOpen, setNewOpen] = useState(() => loadDraft() != null);
  const [restored] = useState(() => loadDraft() != null);
  const [view, setView] = useState<View>('main');
  const [grouped, setGrouped] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [filtersOpen, setFiltersOpen] = useState(false);   // 휴대폰에서만 의미 있음
  const [dialog, setDialog] = useState<{ type: 'delay' | 'inbound' | 'purge'; id: string; stage?: 'ETD' | 'ETA' } | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number>();
  const showToast = (t: { msg: string; undo?: () => void }) => {
    setToast(t); clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  };
  const today = todayKST();

  // 표 영역 너비가 바뀌면(창 크기 조절·스크롤바) 칸 폭을 다시 계산
  const wrapRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState(() => colVars(0));
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidths(colVars(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const timer = useRef<number>();

  const load = useCallback(async () => {
    try {
      const [s, e, a] = await Promise.all([listShipments(), listExceptionTypes(), listActivity(200)]);
      setRows(s); setEx(e); setLoadErr('');
      // 최신 200건으로 갱신하되, '더 보기'로 불러온 오래된 이력은 유지
      setActs((old) => { const min = a.length ? a[a.length - 1].id : Infinity; return [...a, ...old.filter((x) => x.id < min)]; });
    } catch (x) { setLoadErr((x as Error).message); }
  }, []);

  useEffect(() => {
    void load();
    const unsub = subscribe(() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => void load(), 150); });
    const on = () => { setOnline(true); void load(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { unsub(); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [load]);

  const save: Save = useCallback(async (id, expected, next) => {
    setSaveState({ kind: 'saving' });
    try {
      const r = await updateShipment(id, expected, next, name);
      if (r.status === 'ok') {
        setRows((rs) => rs.map((x) => (x.id === id ? r.row : x)));
        setSaveState({ kind: 'saved' });
        return true;
      }
      if (r.status === 'conflict') {
        const row = rows.find((x) => x.id === id);
        setConflict({ id, no: row?.shipment_no ?? '', field: r.field, mine: next[r.field], theirs: r.current, by: r.by });
        setSaveState({ kind: 'idle' });
        void load();
        return false;
      }
      setSaveState({ kind: 'error', msg: '이 선적은 이미 삭제되었습니다' });
      void load();
      return false;
    } catch (x) {
      setSaveState({ kind: 'error', msg: (x as Error).message, retry: () => void save(id, expected, next) });
      return false;
    }
  }, [name, rows, load]);

  const create = async (input: ShipmentInput) => {
    setSaveState({ kind: 'saving' });
    try {
      const row = await createShipment(input, name);
      setRows((rs) => (rs.some((x) => x.id === row.id) ? rs : [...rs, row]));
      setSaveState({ kind: 'saved' });
      return true;
    } catch (x) {
      setSaveState({ kind: 'error', msg: (x as Error).message });
      return false;
    }
  };

  const addException = async (n: string) => {
    if (ex.some((e) => e.name.toLowerCase() === n.toLowerCase())) { alert('이미 있는 예외 상태입니다'); return null; }
    try {
      const e = await addExceptionType(n, name);
      setEx((xs) => [...xs, e]);
      return e.id;
    } catch (x) { setSaveState({ kind: 'error', msg: (x as Error).message }); return null; }
  };

  // Activity·알림에서 Shipment 번호 클릭 → 해당 목록으로 이동해 행 강조
  const openShipment = (a: Activity) => {
    const s = rows.find((x) => x.id === a.shipment_id);
    if (!s) return showToast({ msg: `${a.shipment_no ?? '이 선적'}는 영구 삭제되었습니다` });
    setView(s.location !== 'active' ? s.location : s.status === DONE ? 'completed' : 'main');
    setF(NO_FILTER);
    setHighlight(s.id);
  };
  useEffect(() => {
    if (!highlight) return;
    const t1 = window.setTimeout(() => document.getElementById(`row-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    const t2 = window.setTimeout(() => setHighlight(null), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [highlight]);

  const loadMoreActs = async () => {
    const more = await listActivity(200, acts[acts.length - 1]?.id);
    setActs((xs) => [...xs, ...more]);
    if (more.length < 200) setMoreActs(false);
  };

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-500))); } catch { /* 무시 */ }
  };

  // 행 작업: 제안 수락·닫기, 지연 확정·해제, 입고 완료
  const act = (s: Shipment, sg: Suggestion | null) => (a: RowAction) => {
    const cand = candidateOf(s, today);
    switch (a) {
      case 'accept-suggest': if (sg) void save(s.id, { status: s.status }, { status: sg.to }); break;
      case 'dismiss-suggest': if (sg) dismiss(`${s.id}:${sg.to}`); break;
      case 'advance': if (cand) void save(s.id, { status: s.status }, { status: cand.next }); break;
      case 'delay': setDialog({ type: 'delay', id: s.id, stage: cand?.stage ?? stageOfStatus(s.status) }); break;
      case 'clear': void save(s.id, { delay_confirmed: true }, { delay_confirmed: false }); break;
      case 'dismiss-clear': dismiss(`${s.id}:clear:${s.delay_confirmed_at}`); break;
      case 'inbound': setDialog({ type: 'inbound', id: s.id }); break;
      case 'archive': case 'trash': case 'restore': void move(s, a === 'archive' ? 'archived' : a === 'trash' ? 'trashed' : 'active'); break;
      case 'purge': setDialog({ type: 'purge', id: s.id }); break;
    }
  };

  // Archive / Trash / 복구: 위치만 바꾸고 데이터와 이력은 그대로. 실수 대비 되돌리기 안내.
  const LOC_LABEL = { active: '목록', archived: '보관함', trashed: '휴지통' } as const;
  const move = async (s: Shipment, to: Shipment['location']) => {
    const from = s.location;
    if (!(await save(s.id, { location: from }, { location: to }))) return;
    const where = to === 'active' ? (s.status === DONE ? '입고 완료 목록' : '진행 중 목록') : LOC_LABEL[to];
    showToast({
      msg: `${s.shipment_no} → ${where}${to === 'active' ? '으로 복구했습니다' : '로 이동했습니다'}`,
      undo: () => { setToast(null); void save(s.id, { location: to }, { location: from }); },
    });
  };

  const purge = (s: Shipment) => async () => {
    try {
      const ok = await purgeShipment(s.id, name);
      if (!ok) { setSaveState({ kind: 'error', msg: '휴지통에 있는 선적만 영구 삭제할 수 있습니다' }); return false; }
      setRows((rs) => rs.filter((x) => x.id !== s.id));
      showToast({ msg: `${s.shipment_no}를 영구 삭제했습니다` });
      return true;
    } catch (x) { setSaveState({ kind: 'error', msg: (x as Error).message }); return false; }
  };

  const setPri = (s: Shipment) => (v: number) => void save(s.id, { priority: s.priority ?? 0 }, { priority: v });

  const setExc = (s: Shipment) => async (v: number | null | 'new') => {
    let id: number | null = v === 'new' ? null : v;
    if (v === 'new') {
      const n = prompt('새 예외 상태 이름 (모든 팀원의 선택지에 추가됩니다)')?.trim();
      id = n ? await addException(n) : null;
      if (id == null) return;
    }
    void save(s.id, { exception_id: s.exception_id }, { exception_id: id });
  };

  const saveDelay = (s: Shipment) => async ({ stage, reason, date }: { stage: 'ETD' | 'ETA'; reason: string; date: string }) => {
    const dateField = stage === 'ETD' ? 'etd' : 'eta';
    const next: Record<string, unknown> = { delay_confirmed: true, delay_reason: reason, delay_stage: stage };
    const expected: Record<string, unknown> = { delay_confirmed: s.delay_confirmed, delay_reason: s.delay_reason, delay_stage: s.delay_stage };
    if (date) { next[dateField] = date; expected[dateField] = s[dateField]; }
    return save(s.id, expected, next);
  };

  const saveInbound = (s: Shipment) => async (date: string) => {
    const ok = await save(s.id, { status: s.status, inbound_date: s.inbound_date }, { status: DONE, inbound_date: date });
    if (ok) {
      showToast({
        msg: `${s.shipment_no} → 입고 완료 목록으로 이동했습니다`,
        undo: () => { setToast(null); void save(s.id, { status: DONE, inbound_date: date }, { status: s.status, inbound_date: s.inbound_date }); },
      });
    }
    return ok;
  };

  // 메인 = 일반 위치 + 입고 완료 전, Completed = 일반 위치 + 입고 완료
  const mainRows = useMemo(() => rows.filter((s) => s.location === 'active' && s.status !== DONE), [rows]);
  const doneRows = useMemo(() => rows.filter((s) => s.location === 'active' && s.status === DONE), [rows]);
  const archRows = useMemo(() => rows.filter((s) => s.location === 'archived'), [rows]);
  const trashRows = useMemo(() => rows.filter((s) => s.location === 'trashed'), [rows]);
  const active = { main: mainRows, completed: doneRows, archived: archRows, trashed: trashRows, activity: [] }[view];
  const readOnly = view === 'archived' || view === 'trashed';   // 보관·삭제된 건은 복구 후 수정
  const isCancelled = useCallback((s: Shipment) => exceptionName(s, ex) === 'Cancelled', [ex]);

  // 대시보드: Cancelled는 진행 중 수·PCS에서 제외
  const dash = useMemo(() => {
    const live = mainRows.filter((s) => !isCancelled(s));
    return {
      count: live.length,
      pcs: live.reduce((n, s) => n + (s.pcs ?? 0), 0),
      delayed: live.filter((s) => s.delay_confirmed).length,
      cand: live.filter((s) => candidateOf(s, today)).length,
      cancelled: mainRows.length - live.length,
      byStatus: STATUSES.slice(0, 5).map((st) => [st, live.filter((s) => s.status === st).length] as const),
    };
  }, [mainRows, isCancelled, today]);
  const opts = useMemo(() => ({
    seasons: [...new Set(active.flatMap((s) => s.seasons))].sort(),
    countries: [...new Set(active.map((s) => s.origin_country).filter(Boolean) as string[])].sort(),
  }), [active]);
  const noCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) { const k = s.shipment_no.trim().toLowerCase(); m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [rows]);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const list = active.filter((s) =>
      (!q || [s.shipment_no, s.origin_country, s.bl_awb_no, s.content, ...s.seasons].some((v) => v?.toLowerCase().includes(q))) &&
      (!f.season || s.seasons.includes(f.season)) &&
      (!f.country || s.origin_country === f.country) &&
      (!f.mode || s.ship_mode === f.mode) &&
      (!f.status || s.status === f.status) &&
      (!f.type || s.shipment_type === f.type) &&
      inRange(s.etd, f.etdFrom, f.etdTo) && inRange(s.eta, f.etaFrom, f.etaTo) &&
      (!f.delay || (f.delay === 'cand' ? candidateOf(s, today) != null : (f.delay === 'yes') === s.delay_confirmed)) &&
      (!f.exc || (f.exc === '!Cancelled' ? !isCancelled(s) : exceptionName(s, ex) === f.exc)));
    return list.sort((a, b) => {
      if (grouped && a.status !== b.status) return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
      const x = sortValue(a, sort.key, ex), y = sortValue(b, sort.key, ex);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;   // 빈 값은 항상 맨 아래
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [active, f, sort, ex, grouped, isCancelled, today]);

  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTER);
  const setFilter = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const fmtVal = (v: unknown) => (v == null || v === '' ? '(빈 값)' : Array.isArray(v) ? v.join(', ') || '(빈 값)'
    : conflict?.field === 'exception_id' ? ko('exception', ex.find((e) => e.id === v)?.name ?? String(v))
    : conflict ? ko(conflict.field, String(v)) : String(v));

  return (
    <div className="app">
      <header className="top">
        <span className="brand">✈️ 선적 관리</span>
        <nav>
          <a className={view === 'main' ? 'on' : ''} onClick={() => { setView('main'); setF(NO_FILTER); }}>진행 중</a>
          <a className={view === 'completed' ? 'on' : ''} onClick={() => { setView('completed'); setF(NO_FILTER); }}>입고 완료 <span className="muted small">{doneRows.length}</span></a>
          <a className={view === 'archived' ? 'on' : ''} onClick={() => { setView('archived'); setF(NO_FILTER); }}>보관함 <span className="muted small">{archRows.length}</span></a>
          <a className={view === 'trashed' ? 'on' : ''} onClick={() => { setView('trashed'); setF(NO_FILTER); }}>휴지통 <span className="muted small">{trashRows.length}</span></a>
          <a className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>변경 이력</a>
        </nav>
        <span className="grow" />
        <SaveBadge s={saveState} />
        <Bell items={acts} me={name} onOpen={openShipment} />
        {view !== 'activity' && (
          <ExportMenu
            current={shown.length} all={rows.filter((s) => s.location !== 'trashed').length}
            onCurrent={() => downloadXlsx(shown, ex, false)}
            onAll={() => downloadXlsx(rows.filter((s) => s.location !== 'trashed'), ex, true)} />
        )}
        {view === 'main' && <button className="primary" onClick={() => setNewOpen(true)} disabled={newOpen || !online}>+ 신규</button>}
        <button className="ghost small" onClick={onRename} title="이름 변경">{name} ✎</button>
      </header>

      {!online && <div className="banner danger">인터넷 연결이 끊겼습니다. 다시 연결될 때까지 수정할 수 없습니다.</div>}
      {loadErr && <div className="banner danger">불러오기 실패: {loadErr} <button className="mini" onClick={() => void load()}>다시 시도</button></div>}

      {view === 'main' && (
        <div className="dash">
          <button className="tile" onClick={() => setF({ ...NO_FILTER, exc: '!Cancelled' })}><span>진행 중</span><b>{dash.count.toLocaleString()}</b></button>
          <button className="tile" onClick={() => setF({ ...NO_FILTER, exc: '!Cancelled' })}><span>전체 수량</span><b>{dash.pcs.toLocaleString('en-US')}</b></button>
          <button className="tile alert" onClick={() => setF({ ...NO_FILTER, delay: 'yes' })}><span>지연</span><b>{dash.delayed}</b></button>
          <button className="tile warn" onClick={() => setF({ ...NO_FILTER, delay: 'cand' })}><span>지연 후보</span><b>{dash.cand}</b></button>
          <button className="tile" onClick={() => setF({ ...NO_FILTER, exc: 'Cancelled' })}><span>취소</span><b className="muted">{dash.cancelled}</b></button>
          <div className="chips">
            {dash.byStatus.map(([st, n]) => (
              <button key={st} className={`badge ${STATUS_TONE[st]} ${f.status === st ? 'picked' : ''}`}
                onClick={() => setF({ ...NO_FILTER, status: st, exc: '!Cancelled' })}>{st} {n}</button>
            ))}
          </div>
        </div>
      )}

      {view === 'activity' ? (
        <section className="activity-page">
          <ActivityList items={acts} onOpen={openShipment} />
          {moreActs && acts.length >= 200 && <button onClick={() => void loadMoreActs()}>더 보기</button>}
        </section>
      ) : <>
      {view === 'trashed' && <div className="banner note">휴지통의 선적은 자동으로 지워지지 않습니다. 복구하거나, 행 메뉴(⋯)에서 직접 영구 삭제할 수 있습니다.</div>}
      {view === 'archived' && <div className="banner note">보관함은 진행 중 목록에서 뺀 선적을 모아 두는 곳입니다. 행 메뉴(⋯)에서 언제든 복구할 수 있습니다.</div>}
      <div className={`filters ${filtersOpen ? 'open' : ''}`}>
        <input className="search" placeholder="번호, 국가, BL·AWB, 시즌, 내용 검색" value={f.q} onChange={setFilter('q')} />
        <button className="mobile-only mini" onClick={() => setFiltersOpen(!filtersOpen)}>필터 {filtersOpen ? '▴' : '▾'}{filtered ? ' ●' : ''}</button>
        <select value={f.season} onChange={setFilter('season')}><option value="">시즌</option>{opts.seasons.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.country} onChange={setFilter('country')}><option value="">출발 국가</option>{opts.countries.map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.mode} onChange={setFilter('mode')}><option value="">운송 방식</option>{SHIP_MODES.map((o) => <option key={o} value={o}>{ko('ship_mode', o)}</option>)}</select>
        <select value={f.status} onChange={setFilter('status')}><option value="">진행 상태</option>{(view === 'main' ? STATUSES.slice(0, 5) : view === 'completed' ? [DONE] : STATUSES).map((o) => <option key={o}>{o}</option>)}</select>
        <select value={f.type} onChange={setFilter('type')}><option value="">구분</option><option value="Product">상품</option><option value="Sample">샘플</option></select>
        <select value={f.delay} onChange={setFilter('delay')}><option value="">지연 여부</option><option value="yes">지연</option><option value="cand">지연 후보</option><option value="no">지연 아님</option></select>
        <label className="range">출항일 <input type="date" value={f.etdFrom} onChange={setFilter('etdFrom')} />~<input type="date" value={f.etdTo} onChange={setFilter('etdTo')} /></label>
        <label className="range">도착일 <input type="date" value={f.etaFrom} onChange={setFilter('etaFrom')} />~<input type="date" value={f.etaTo} onChange={setFilter('etaTo')} /></label>
        <label className="small muted check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> 상태별 묶어 보기</label>
        {filtered && <button className="ghost small" onClick={() => setF(NO_FILTER)}>필터 초기화</button>}
        <span className="muted small count">{shown.length} / {active.length}건</span>
      </div>

      <div className="table-wrap" ref={wrapRef} style={widths as React.CSSProperties}>
        <table className="grid">
          <colgroup>{COLUMNS.map((c) => <col key={c.key} style={{ width: colWidth(c.key) }} />)}</colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`${c.sticky ? 'sticky' : ''} ${c.key === LAST_STICKY ? 'sticky-last' : ''} ${c.right ? 'r' : ''}`} style={c.sticky ? { left: stickyLeft(c.key) } : undefined}
                  onClick={() => setSort({ key: c.key, asc: sort.key === c.key ? !sort.asc : true })}>
                  {c.label}{sort.key === c.key ? (sort.asc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view === 'main' && newOpen && <NewRow existingNos={new Set(noCount.keys())} restored={restored} onSave={create} onClose={() => setNewOpen(false)} />}
            {shown.map((s, i) => {
              const sg = suggestOf(s);
              const showSg = sg && online && !dismissed.includes(`${s.id}:${sg.to}`) ? sg : null;
              const row = readOnly
                ? { suggest: null, cand: null, clearSug: false, act: act(s, null), menu: online, setExc: setExc(s), setPri: setPri(s) }
                : {
                  suggest: showSg, cand: online ? candidateOf(s, today) : null, act: act(s, showSg), menu: online, setExc: setExc(s), setPri: setPri(s),
                  clearSug: online && clearSuggested(s) && !dismissed.includes(`${s.id}:clear:${s.delay_confirmed_at}`),
                };
              const head = grouped && (i === 0 || shown[i - 1].status !== s.status);
              return (
                <Fragment key={s.id}>
                  {head && (
                    <tr className="group-row"><td colSpan={COLUMNS.length}><span className="group-label">
                      <span className={`badge ${STATUS_TONE[s.status]}`}>{s.status}</span> {shown.filter((x) => x.status === s.status).length}건
                    </span></td></tr>
                  )}
                  <tr id={`row-${s.id}`} className={`${isCancelled(s) ? 'cancelled' : ''} ${highlight === s.id ? 'flash' : ''} ${(s.priority ?? 0) > 0 ? `pri-${s.priority}` : ''}`}>
                    {COLUMNS.map((c) => (
                      <Cell key={c.key} col={c} s={s} ex={ex} canEdit={online && !readOnly}
                        dupNo={(noCount.get(s.shipment_no.trim().toLowerCase()) ?? 0) > 1}
                        editing={editing === `${s.id}:${c.key}`}
                        onEdit={(on) => setEditing(on ? `${s.id}:${c.key}` : null)} save={save}
                        onAddException={addException} row={row} />
                    ))}
                  </tr>
                </Fragment>
              );
            })}
            {!shown.length && !newOpen && (
              <tr><td colSpan={COLUMNS.length} className="empty">{filtered ? '조건에 맞는 선적이 없습니다.' : ({ main: '진행 중인 선적이 없습니다. + 신규로 등록하세요.', completed: '창고 입고가 완료된 선적이 없습니다.', archived: '보관함이 비어 있습니다.', trashed: '휴지통이 비어 있습니다.', activity: '' })[view]}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {view === 'main' && (
        <section className="recent">
          <div className="recent-head"><span>최근 변경</span><button className="link small" onClick={() => setView('activity')}>전체 보기</button></div>
          <ActivityList items={acts.filter((a) => a.shipment_no).slice(0, 5)} onOpen={openShipment} compact />
        </section>
      )}
      </>}

      {dialog && (() => {
        const s = rows.find((x) => x.id === dialog.id);
        if (!s) return null;
        const close = () => setDialog(null);
        if (dialog.type === 'purge') return <PurgeDialog s={s} onPurge={purge(s)} onClose={close} />;
        return dialog.type === 'delay'
          ? <DelayDialog s={s} stage={dialog.stage ?? 'ETD'} onSave={saveDelay(s)} onClose={close} />
          : <InboundDialog s={s} onSave={saveInbound(s)} onClose={close} />;
      })()}

      {toast && (
        <div className="toast" role="status">
          {toast.msg}
          {toast.undo && <button className="link" onClick={toast.undo}>되돌리기</button>}
          <button className="link muted" aria-label="닫기" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {conflict && (
        <div className="conflict" role="alertdialog">
          <p><b>{conflict.no}</b>의 <b>{COLUMNS.find((c) => c.field === conflict.field)?.label ?? conflict.field}</b> 값을 {conflict.by}님이 방금 바꿨습니다.</p>
          <p className="small">내 값: {fmtVal(conflict.mine)} · {conflict.by}님 값: {fmtVal(conflict.theirs)}</p>
          <div className="row">
            <button className="primary" onClick={() => { const c = conflict; setConflict(null); void save(c.id, { [c.field]: c.theirs }, { [c.field]: c.mine }); }}>내 값으로 저장</button>
            <button onClick={() => setConflict(null)}>{conflict.by}님 값 유지</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportMenu({ current, all, onCurrent, onAll }: { current: number; all: number; onCurrent: () => Promise<void>; onAll: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); setOpen(false); } };
  return (
    <div className="mail" ref={box}>
      <button onClick={() => setOpen(!open)} disabled={busy}>{busy ? '만드는 중…' : '엑셀'}</button>
      {open && (
        <div className="pop menu export">
          <button className="ghost" onClick={() => void run(onCurrent)}>현재 검색·필터 결과 <span className="muted small">{current}건</span></button>
          <button className="ghost" onClick={() => void run(onAll)}>전체 선적 <span className="muted small">{all}건 · 휴지통 제외</span></button>
        </div>
      )}
    </div>
  );
}

function SaveBadge({ s }: { s: SaveState }) {
  if (s.kind === 'saving') return <span className="save muted">저장 중…</span>;
  if (s.kind === 'saved') return <span className="save ok">✓ 저장됨</span>;
  if (s.kind === 'error') {
    return <span className="save err" title={s.msg}>저장 실패{s.retry && <> · <button className="link" onClick={s.retry}>다시 시도</button></>}</span>;
  }
  return null;
}
