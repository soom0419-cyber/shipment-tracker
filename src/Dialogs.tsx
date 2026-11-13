import { useState } from 'react';
import { fmtDate } from './columns';
import { todayKST } from './delay';
import type { Shipment } from './types';

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// 지연 등록/수정: 사유 필수, 변경 예정일 선택. 이전 날짜는 Activity에 남는다.
export function DelayDialog({ s, stage: initStage, onSave, onClose }: {
  s: Shipment; stage: 'ETD' | 'ETA';
  onSave: (v: { stage: 'ETD' | 'ETA'; reason: string; date: string }) => Promise<boolean>; onClose: () => void;
}) {
  const [stage, setStage] = useState<'ETD' | 'ETA'>(s.delay_stage ?? initStage);
  const [reason, setReason] = useState(s.delay_reason ?? '');
  const [date, setDate] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cur = stage === 'ETD' ? s.etd : s.eta;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setErr('지연 사유를 입력하세요');
    setBusy(true);
    if (await onSave({ stage, reason: reason.trim(), date })) onClose(); else setBusy(false);
  };
  return (
    <Modal title={`${s.shipment_no} 지연 ${s.delay_confirmed ? '수정' : '확정'}`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="seg">
          {(['ETD', 'ETA'] as const).map((x) => (
            <label key={x}><input type="radio" checked={stage === x} onChange={() => setStage(x)} /> {x} 지연</label>
          ))}
        </div>
        <label>지연 사유 (필수)<textarea rows={3} value={reason} autoFocus onChange={(e) => { setReason(e.target.value); setErr(''); }} /></label>
        <label>변경된 {stage} (선택) <span className="muted small">현재 {cur ? fmtDate(cur) : '미입력'}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {err && <p className="cell-err">{err}</p>}
        <div className="row">
          <button className="primary" disabled={busy}>{busy ? '저장 중…' : '지연 확정'}</button>
          <button type="button" onClick={onClose}>취소</button>
        </div>
      </form>
    </Modal>
  );
}

// 창고 입고 완료: 실제 입고일 입력 → 확인 → 상태 변경
export function InboundDialog({ s, onSave, onClose }: {
  s: Shipment; onSave: (date: string) => Promise<boolean>; onClose: () => void;
}) {
  const [date, setDate] = useState(s.inbound_date ?? todayKST());
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    setBusy(true);
    if (await onSave(date)) onClose(); else setBusy(false);
  };
  return (
    <Modal title={`${s.shipment_no} 창고 입고 완료`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>실제 창고 입고일<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <p className="muted small">전체 물량({s.pcs != null ? `${s.pcs.toLocaleString('en-US')} PCS` : 'PCS 미입력'})이 입고되었나요? 확인하면 상태가 '창고 입고 완료'로 바뀌고 Completed로 이동합니다.</p>
        <div className="row">
          <button className="primary" disabled={busy || !date}>{busy ? '저장 중…' : '입고 완료'}</button>
          <button type="button" onClick={onClose}>취소</button>
        </div>
      </form>
    </Modal>
  );
}

// 영구 삭제: 번호를 직접 입력해야 실행. 삭제 직전 값은 변경 이력에 남는다.
export function PurgeDialog({ s, onPurge, onClose }: { s: Shipment; onPurge: () => Promise<boolean>; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim() === s.shipment_no.trim();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    if (await onPurge()) onClose(); else setBusy(false);
  };
  return (
    <Modal title={`${s.shipment_no} 영구 삭제`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="small">영구 삭제하면 목록과 Trash에서 사라지고 <b>화면에서 복구할 수 없습니다.</b> 삭제 직전 값은 변경 이력에 남고, 운영 백업이 설정되어 있으면 DB 백업(7일)과 외부 백업(90일)에도 남습니다.</p>
        <label>확인을 위해 Shipment 번호 <b>{s.shipment_no}</b>를 입력하세요<input value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} /></label>
        <div className="row">
          <button className="danger" disabled={!ok || busy}>{busy ? '삭제 중…' : '영구 삭제'}</button>
          <button type="button" onClick={onClose}>취소</button>
        </div>
      </form>
    </Modal>
  );
}
