import { useEffect, useMemo, useState } from 'react';
import { getVolume, type VolumeDoc } from './api';
import { todayKST } from './delay';

const MATS = ['ICONIC', 'COLLECTION', '기타'] as const;
const MAT_LABEL: Record<string, string> = { ICONIC: '아이코닉', COLLECTION: '컬렉션', 기타: '기타' };
const SEASONS = ['AW26', 'SS27'];
const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const n = (v: number) => v.toLocaleString('en-US');
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const dow = (d: string) => DOW[(new Date(`${d}T00:00:00`).getDay() + 6) % 7];

// 해당 월을 덮는 주(월~일) 목록
function weeksOf(ym: string): string[][] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const out: string[][] = [];
  for (const d = new Date(start); d <= last; d.setDate(d.getDate() + 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return iso(x); }));
  }
  return out;
}

export function Volume() {
  const [doc, setDoc] = useState<VolumeDoc | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [season, setSeason] = useState('AW26');
  const today = todayKST();
  const [ym, setYm] = useState(today.slice(0, 7));

  useEffect(() => { getVolume().then(setDoc).catch((e) => { setErr((e as Error).message); setDoc(null); }); }, []);
  const weeks = useMemo(() => weeksOf(ym), [ym]);

  if (doc === undefined) return <p className="center muted">불러오는 중…</p>;
  if (!doc) return <p className="center muted">{err ? `불러오기 실패: ${err}` : '아직 올라온 물동량 집계가 없습니다. 대시보드를 게시하면 채워집니다.'}</p>;

  const shift = (k: number) => { const [y, m] = ym.split('-').map(Number); setYm(iso(new Date(y, m - 1 + k, 1)).slice(0, 7)); };
  const cell = (d: string) => doc.days[d]?.[season] ?? {};
  const chaOf = (d: string) => doc.cha[d]?.[season] ?? [];
  const sum = (ds: string[]) => MATS.map((m) => ds.reduce((a, d) => a + (cell(d)[m] ?? 0), 0));
  const rate = doc.rates[season] ?? {};
  const label = `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;

  const Lines = ({ q }: { q: Record<string, number> }) => (
    <>{MATS.map((m) => (q[m] ? <div key={m} className={`vl m-${m}`}><span>{MAT_LABEL[m]}</span><b>{n(q[m])}</b></div> : null))}</>
  );

  return (
    <section className="volume">
      <div className="vol-head">
        <div className="vol-nav">
          <button className="mini" onClick={() => shift(-1)}>◀</button>
          <b>{label}</b>
          <button className="mini" onClick={() => shift(1)}>▶</button>
          <button className="mini" onClick={() => setYm(today.slice(0, 7))}>오늘</button>
        </div>
        <div className="vol-seasons">
          {SEASONS.map((s) => <button key={s} className={season === s ? 'picked' : ''} onClick={() => setSeason(s)}>{s}</button>)}
        </div>
      </div>

      <div className="vol-rates">
        <span className="muted small">{season} 누계 입고율 (물류 입고 기준)</span>
        {(['COLLECTION', 'ICONIC'] as const).map((m) => {
          const r = rate[m];
          return (
            <div key={m} className="rate">
              <span>{MAT_LABEL[m]}</span>
              <b>{r?.rate != null ? `${r.rate}%` : '-'}</b>
              {r && <small className="muted">{n(r.in)} / {n(r.order)}장</small>}
            </div>
          );
        })}
      </div>

      <div className="cal">
        <div className="cal-row cal-dow">
          {DOW.map((d) => <div key={d}>{d}</div>)}<div className="cal-sum">주간 합계</div>
        </div>
        {weeks.map((w) => {
          const t = sum(w);
          return (
            <div className="cal-row" key={w[0]}>
              {w.map((d) => {
                const q = cell(d), cs = chaOf(d);
                return (
                  <div key={d} className={`cal-day ${d.slice(0, 7) !== ym ? 'out' : ''} ${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`}>
                    <div className="dnum">{Number(d.slice(8))}{cs.length > 0 && <small>{cs.map((c) => `${c}차`).join('·')}</small>}</div>
                    <Lines q={q} />
                  </div>
                );
              })}
              <div className="cal-sum">
                {t.some((x) => x > 0) ? <>
                  {MATS.map((m, i) => (t[i] ? <div key={m} className={`vl m-${m}`}><span>{MAT_LABEL[m]}</span><b>{n(t[i])}</b></div> : null))}
                  <div className="vl total"><span>합계</span><b>{n(t.reduce((a, b) => a + b, 0))}</b></div>
                </> : <span className="muted">-</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="weeklist">
        {weeks.map((w) => {
          const t = sum(w), ds = w.filter((d) => MATS.some((m) => cell(d)[m]));
          return (
            <div className="wk" key={w[0]}>
              <div className="wk-head"><b>{md(w[0])} ~ {md(w[6])}</b><span className="muted small">합계 {n(t.reduce((a, b) => a + b, 0))}장</span></div>
              {ds.length === 0 ? <div className="muted small">입고 예정 없음</div> : ds.map((d) => (
                <div key={d} className={`wk-day ${d < today ? 'past' : ''}`}>
                  <div className="dnum">{md(d)} ({dow(d)}){chaOf(d).length > 0 && <small>{chaOf(d).map((c) => `${c}차`).join('·')}</small>}</div>
                  <Lines q={cell(d)} />
                </div>
              ))}
              {ds.length > 0 && <div className="wk-total">{MATS.map((m, i) => (t[i] ? <span key={m}>{MAT_LABEL[m]} {n(t[i])}</span> : null))}</div>}
            </div>
          );
        })}
      </div>
      <p className="muted small vol-note">기준: {doc.generated} 대시보드 갱신 · 입고 날짜는 선적 관리의 물류 예상 입고일(없으면 입고 마스터파일 입고예정일) · 선적 일정이 아직 없는 물량은 포함되지 않습니다.</p>
    </section>
  );
}
