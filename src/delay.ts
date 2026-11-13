// 지연 판단 규칙 (확정본). 후보는 화면에서 계산만 하고, 확정·해제는 사람이 한다.
import type { Shipment, Status } from './types.ts';
import { STATUSES } from './types.ts';

export const todayKST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

const idx = (s: Status) => STATUSES.indexOf(s);

export interface Candidate { stage: 'ETD' | 'ETA'; next: Status }

// ETD 후보: 선적 전(선적 예정·부킹 대기·부킹 완료)인데 ETD < 오늘
// ETA 후보: 이동 중(선적 완료·운송 중)인데 ETA < 오늘
// 예외 상태(On Hold·Cancelled 등)가 있으면 감지하지 않음
export function candidateOf(s: Shipment, today = todayKST()): Candidate | null {
  if (s.exception_id != null || s.location !== 'active') return null;
  const i = idx(s.status);
  if (i <= 2 && s.etd && s.etd < today) return { stage: 'ETD', next: '선적 완료' };
  if ((i === 3 || i === 4) && s.eta && s.eta < today) return { stage: 'ETA', next: '입항 완료' };
  return null;
}

// 지연된 단계를 넘어갔으면 해제를 제안 (ETD 지연 → 선적 완료 이후, ETA 지연 → 입항 완료 이후)
export function clearSuggested(s: Shipment): boolean {
  if (!s.delay_confirmed || !s.delay_stage) return false;
  return idx(s.status) >= (s.delay_stage === 'ETD' ? 3 : 5);
}

// 선적 완료 이후인데 ETA가 비어 있으면 '미입력' 강조
export const etaMissing = (s: Shipment) => !s.eta && (idx(s.status) === 3 || idx(s.status) === 4);

export const stageOfStatus = (s: Status): 'ETD' | 'ETA' => (idx(s) <= 2 ? 'ETD' : 'ETA');

// 셀프 체크: node --experimental-strip-types src/delay.ts
declare const process: { argv?: string[] } | undefined;
if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('delay.ts')) {
  const base = { exception_id: null, location: 'active', delay_confirmed: false, delay_stage: null, eta: null, etd: null } as unknown as Shipment;
  const t = '2026-11-13';
  const c = (o: Partial<Shipment>) => candidateOf({ ...base, ...o } as Shipment, t);
  console.assert(c({ status: '부킹 완료', etd: '2026-11-12' })?.stage === 'ETD');
  console.assert(c({ status: '부킹 완료', etd: '2026-11-13' }) === null, '오늘은 아직 후보 아님');
  console.assert(c({ status: '선적 완료', etd: '2026-11-01' }) === null, '선적 후엔 ETD 무시');
  console.assert(c({ status: '운송 중', eta: '2026-11-10' })?.next === '입항 완료');
  console.assert(c({ status: '입항 완료', eta: '2026-11-10' }) === null);
  console.assert(c({ status: '부킹 대기', etd: '2026-11-01', exception_id: 1 }) === null, '예외 상태는 제외');
  console.assert(clearSuggested({ ...base, status: '선적 완료', delay_confirmed: true, delay_stage: 'ETD' } as Shipment));
  console.assert(!clearSuggested({ ...base, status: '운송 중', delay_confirmed: true, delay_stage: 'ETA' } as Shipment));
  console.log('delay rules OK');
}
