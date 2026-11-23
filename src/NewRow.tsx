// 신규 입력 행. 입력 내용은 이 브라우저(localStorage)에만 자동 저장되고, 저장을 눌러야 공용 목록에 등록된다.
import { useEffect, useState } from 'react';
import type { Col } from './columns';
import { COLUMNS, LAST_STICKY, stickyLeft, isUrl, parseInput } from './columns';
import { ko } from './ko';
import type { ShipmentInput } from './types';

const DRAFT_KEY = 'st-draft';
type Draft = Record<string, string>;

export const loadDraft = (): Draft | null => {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { return null; }
};
const storeDraft = (d: Draft | null) => {
  try { d ? localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) : localStorage.removeItem(DRAFT_KEY); } catch { /* 저장 공간 없음: 무시 */ }
};

interface Props {
  existingNos: Set<string>;
  restored: boolean;
  onSave: (input: ShipmentInput) => Promise<boolean>;
  onClose: () => void;
}

export function NewRow({ existingNos, restored, onSave, onClose }: Props) {
  const [d, setD] = useState<Draft>(() => loadDraft() ?? { status: '선적 예정' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => storeDraft(d), [d]);

  const set = (k: string, v: string) => { setD({ ...d, [k]: v }); setErrs({ ...errs, [k]: '' }); };
  const dup = existingNos.has((d.shipment_no ?? '').trim().toLowerCase());

  const save = async () => {
    const input: Record<string, unknown> = {};
    const e: Record<string, string> = {};
    for (const c of COLUMNS) {
      if (!c.field) continue;
      if (c.kind === 'mail') {
        const urls = (d[c.key] ?? '').split(/\s+/).filter(Boolean);
        if (urls.some((u) => !isUrl(u))) e[c.key] = 'http(s):// 주소만 가능';
        input[c.field] = urls;
        continue;
      }
      const p = parseInput(c, d[c.key] ?? '');
      if ('error' in p) e[c.key] = p.error; else input[c.field] = p.value;
    }
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const ok = await onSave(input as ShipmentInput);
    setBusy(false);
    if (ok) { storeDraft(null); onClose(); }
  };

  const cancel = () => {
    const filled = Object.entries(d).some(([k, v]) => k !== 'status' && v.trim());
    if (filled && !confirm('작성 중인 내용을 지울까요?')) return;
    storeDraft(null);
    onClose();
  };

  return (
    <>
      <tr className="new-row">
        {COLUMNS.map((c) => (
          <td key={c.key} className={`${c.sticky ? 'sticky' : ''} ${c.key === LAST_STICKY ? 'sticky-last' : ''} ${c.right ? 'r' : ''}`} style={c.sticky ? { left: stickyLeft(c.key) } : undefined}>
            {c.field ? <Field c={c} v={d[c.key] ?? ''} set={(v) => set(c.key, v)} /> : null}
            {errs[c.key] && <div className="cell-err">{errs[c.key]}</div>}
            {c.key === 'shipment_no' && dup && <div className="warn">같은 번호가 이미 있습니다 (등록은 가능)</div>}
          </td>
        ))}
      </tr>
      <tr className="new-row-bar">
        <td colSpan={COLUMNS.length}>
          <div className="new-bar">
            <button className="primary" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '저장'}</button>
            <button onClick={cancel}>취소</button>
            <span className="muted small">
              {restored ? '이전에 작성하던 내용을 복구했습니다. ' : ''}작성 중인 내용은 이 브라우저에만 자동 저장됩니다. 저장을 눌러야 팀원에게 보입니다.
            </span>
          </div>
        </td>
      </tr>
    </>
  );
}

function Field({ c, v, set }: { c: Col; v: string; set: (v: string) => void }) {
  const ph: Record<string, string> = { shipment_no: '필수', seasons: 'AW27, R28', mail_links: 'URL (여러 개는 띄어쓰기)' };
  if (c.kind === 'exception') return null;   // 예외 상태는 등록 후 목록에서 지정
  if (c.kind === 'select') {
    return (
      <select value={v} onChange={(e) => set(e.target.value)}>
        {!c.required && <option value="">—</option>}
        {(c.options ?? []).filter((o) => o !== '입고 완료').map((o) => <option key={o} value={o}>{ko(c.key, o)}</option>)}
      </select>
    );
  }
  if (c.kind === 'textarea') return <textarea rows={2} value={v} onChange={(e) => set(e.target.value)} />;
  return <input type={c.kind === 'date' ? 'date' : 'text'} value={v} placeholder={ph[c.key] ?? ''}
    inputMode={c.kind === 'int' ? 'numeric' : undefined} onChange={(e) => set(e.target.value)} />;
}
