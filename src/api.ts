import { createClient } from '@supabase/supabase-js';
import type { Activity, EditableField, ExceptionType, Shipment, ShipmentInput, UpdateResult } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const configured = Boolean(url && key);
export const sb = createClient(url ?? 'http://localhost', key ?? 'missing');

const must = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

// ── 접속: 익명 세션(브라우저에 저장) + 팀 접속 코드 확인 ──
export async function isMember(): Promise<boolean> {
  const { data } = await sb.auth.getSession();
  if (!data.session) return false;
  return must(await sb.rpc('is_member')) as boolean;
}

export async function joinTeam(code: string): Promise<boolean> {
  const { data } = await sb.auth.getSession();
  if (!data.session) must(await sb.auth.signInAnonymously());
  return must(await sb.rpc('join_team', { p_code: code })) as boolean;
}

// ── 조회 ──
export async function listShipments(): Promise<Shipment[]> {
  return must(await sb.from('shipments').select('*').order('etd', { ascending: true, nullsFirst: false }));
}

export async function listExceptionTypes(): Promise<ExceptionType[]> {
  return must(await sb.from('exception_types').select('id,name,is_default').order('id'));
}

// 최신순. beforeId를 주면 그보다 오래된 것만 (더 보기)
export async function listActivity(limit = 200, beforeId?: number): Promise<Activity[]> {
  let q = sb.from('activity_log').select('id,shipment_id,shipment_no,action,field,old_value,new_value,actor,created_at');
  if (beforeId) q = q.lt('id', beforeId);
  return must(await q.order('id', { ascending: false }).limit(limit));
}

// ── 변경 ──
export async function createShipment(input: ShipmentInput, actor: string): Promise<Shipment> {
  return must(await sb.from('shipments').insert({ ...input, created_by: actor, updated_by: actor }).select().single());
}

// expected: 편집 시작 시점의 값. 그 사이 다른 사람이 바꿨으면 { status: 'conflict' }
export async function updateShipment(
  id: string, expected: Partial<Record<EditableField, unknown>>, next: Partial<Record<EditableField, unknown>>, actor: string,
): Promise<UpdateResult> {
  return must(await sb.rpc('update_shipment', { p_id: id, p_expected: expected, p_new: next, p_actor: actor })) as UpdateResult;
}

export async function purgeShipment(id: string, actor: string): Promise<boolean> {
  return must(await sb.rpc('purge_shipment', { p_id: id, p_actor: actor })) as boolean;
}

export async function addExceptionType(name: string, actor: string): Promise<ExceptionType> {
  return must(await sb.from('exception_types').insert({ name, created_by: actor }).select('id,name,is_default').single());
}

// ── 실시간: 어느 테이블이든 바뀌면 콜백 ──
export function subscribe(onChange: (table: string) => void): () => void {
  const ch = sb.channel('db');
  for (const table of ['shipments', 'activity_log', 'exception_types']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange(table));
  }
  ch.subscribe();
  return () => { void sb.removeChannel(ch); };
}
