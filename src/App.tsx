import { useEffect, useState } from 'react';
import { configured, isMember, joinTeam } from './api';
import { Tracker } from './Tracker';

const NAME_KEY = 'st-name';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
const writeName = (n: string) => { try { localStorage.setItem(NAME_KEY, n); } catch { /* 저장 실패해도 이번 접속은 진행 */ } };

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'gate' | 'in'>('loading');
  const [name, setName] = useState(readName);

  useEffect(() => {
    if (!configured) return;
    isMember().then((ok) => setPhase(ok && readName() ? 'in' : 'gate')).catch(() => setPhase('gate'));
  }, []);

  const rename = () => {
    const n = prompt('수정 이력에 표시할 이름', name)?.trim();
    if (n) { writeName(n); setName(n); }
  };

  if (!configured) return <p className="center">.env 에 Supabase URL / publishable 키가 없습니다. .env.example 을 참고하세요.</p>;
  if (phase === 'loading') return <p className="center muted">불러오는 중…</p>;
  if (phase === 'gate') return <Gate name={name} onDone={(n) => { setName(n); setPhase('in'); }} />;
  return <Tracker name={name} onRename={rename} />;
}

function Gate({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [n, setN] = useState(name);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!n.trim()) return setErr('이름을 입력하세요');
    setBusy(true);
    try {
      if (!(await joinTeam(code))) return setErr('접속 코드가 맞지 않습니다. 여러 번 틀리면 10분 동안 막힙니다.');
      writeName(n.trim());
      onDone(n.trim());
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="gate" onSubmit={submit}>
      <h1>선적 관리</h1>
      <label>이름<input value={n} onChange={(e) => setN(e.target.value)} placeholder="수정 이력에 표시됩니다" autoFocus /></label>
      <label>팀 접속 코드<input type="password" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? '확인 중…' : '입장'}</button>
      {err && <p className="cell-err">{err}</p>}
      <p className="muted small">이름은 본인 확인 수단이 아니며, 이 브라우저에만 저장됩니다.</p>
    </form>
  );
}
