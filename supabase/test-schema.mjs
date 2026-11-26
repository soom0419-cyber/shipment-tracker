// schema.sql 자체 검증: 로컬 메모리 DB(PGlite)에 Supabase 흉내(auth.uid, anon/authenticated 역할)를 깔고
// 권한·트리거·충돌 확인·영구 삭제를 실제로 실행해 봅니다.  실행: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

await db.exec(`
  create schema auth;
  create role anon; create role authenticated;
  grant usage on schema public, auth to anon, authenticated;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
// 마이그레이션은 이미 적용된 DB에 다시 실행해도 안전해야 함
for (const f of ['002_delay_stage.sql', '003_priority.sql', '004_status_steps.sql', '005_logistics_eta.sql', '006_inbound_schedule.sql', '007_logistics_auto.sql']) await db.exec(readFileSync(new URL(`./migrations/${f}`, import.meta.url), 'utf8'));
await db.query(`select set_access_code('test-code-1234')`);

const anonRpc = async (tok) => {
  await db.exec('reset role; set role anon;');
  try { return (await db.query(`select inbound_schedule($1) r`, [tok])).rows[0].r; } finally { await db.exec('reset role'); }
};
await db.query(`insert into read_tokens (token_hash, label) values (encode(sha256('test-token'::bytea), 'hex'), 't')`);

const as = async (uid, sql, params = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const fails = async (uid, sql, params, re) =>
  assert.rejects(() => as(uid, sql, params), re, `should fail: ${sql}`);
const log = async () => (await db.query(`select action, field, old_value, new_value, actor from activity_log order by id`)).rows;
const upd = async (id, expected, next, actor = '김구매') =>
  (await as(U1, `select update_shipment($1, $2, $3, $4) r`, [id, expected, next, actor]))[0].r;

// 1) 팀원이 아니면 아무것도 못 봄 / 못 씀
assert.equal((await as(U1, `select * from shipments`)).length, 0);
await fails(U1, `insert into shipments (shipment_no, created_by, updated_by) values ('X', 'a', 'a')`, [], /row-level security/);
assert.equal((await as(U1, `select join_team('wrong') ok`))[0].ok, false);
assert.equal((await as(U1, `select join_team('test-code-1234') ok`))[0].ok, true);

// 2) 등록 → create 이력, updated_by 자동
const [row] = await as(U1, `insert into shipments (shipment_no, seasons, pcs, created_by, updated_by)
  values ('SH-01', '{AW27,R28}', 1200, '김구매', '') returning *`);
assert.equal(row.status, '선적 예정');
assert.equal(row.updated_by, '김구매');
await fails(U1, `insert into shipments (shipment_no, created_by, updated_by, location) values ('Y', 'a', 'a', 'trashed')`, [], /row-level security/);
await fails(U1, `insert into shipments (shipment_no, pcs, created_by, updated_by) values ('Y', -1, 'a', 'a')`, [], /check constraint/);

// 3) 셀 수정 + 이력
let r = await upd(row.id, { status: '선적 예정', etd: null }, { status: '부킹 대기', etd: '2026-11-20' });
assert.equal(r.status, 'ok');
assert.equal(r.row.etd, '2026-11-20');

// 4) 충돌: 편집 시작 값이 낡았으면 저장 안 함
r = await upd(row.id, { status: '선적 예정' }, { status: '부킹 완료' }, '이담당');
assert.equal(r.status, 'conflict');
assert.equal(r.current, '부킹 대기');
assert.equal(r.by, '김구매');

// 5) 직접 UPDATE/DELETE, 이력 삭제, 코드 변경은 막힘
await fails(U1, `update shipments set pcs = 1`, [], /permission denied/);
await fails(U1, `delete from shipments`, [], /permission denied/);
await fails(U1, `delete from activity_log`, [], /permission denied/);
await fails(U1, `select set_access_code('hacked-code-1')`, [], /permission denied/);
await fails(U1, `select update_shipment($1, '{"created_by":"a"}', '{"created_by":"b"}', 'x')`, [row.id], /수정할 수 없는 필드/);

// 6) 입고 완료는 입고일 필수
await assert.rejects(() => upd(row.id, { status: '부킹 대기' }, { status: '입고 완료' }), /inbound_needs_date/);
r = await upd(row.id, { status: '부킹 대기', inbound_date: null }, { status: '입고 완료', inbound_date: '2026-12-01' });
assert.equal(r.status, 'ok');

// 7) 지연 확정은 사유 필수, 확정 시각 자동
await assert.rejects(() => upd(row.id, { delay_confirmed: false }, { delay_confirmed: true }), /delay_needs_reason/);
r = await upd(row.id, { delay_confirmed: false, delay_reason: null, delay_stage: null }, { delay_confirmed: true, delay_reason: '항만 혼잡', delay_stage: 'ETA' });
assert.equal(r.row.delay_stage, 'ETA');
r = await upd(row.id, { priority: 0 }, { priority: 2 });
assert.equal(r.row.priority, 2);
r = await upd(row.id, { logistics_eta: null }, { logistics_eta: '2026-12-10' });
assert.equal(r.row.logistics_eta, '2026-12-10');
await assert.rejects(() => upd(row.id, { priority: 2 }, { priority: 5 }), /check constraint/);
assert.ok(r.row.delay_confirmed_at);

// 8) 예외 상태: 이름으로 기록 / 사용자 추가 상태도 기록
const [hold] = await as(U1, `select id from exception_types where name = 'On Hold'`);
await upd(row.id, { exception_id: null }, { exception_id: Number(hold.id) });
await as(U1, `insert into exception_types (name, created_by) values ('통관 보류', '김구매')`);

// 9) Trash → 영구 삭제 (Trash 아닌 건 거부), 스냅샷 보존
const [other] = await as(U1, `insert into shipments (shipment_no, created_by, updated_by) values ('SH-02', '이담당', '') returning id`);
assert.equal((await as(U1, `select purge_shipment($1, '이담당') ok`, [other.id]))[0].ok, false);
await upd(row.id, { location: 'active' }, { location: 'trashed' });
assert.equal((await as(U1, `select purge_shipment($1, '김구매') ok`, [row.id]))[0].ok, true);
const [purge] = (await db.query(`select actor, snapshot from activity_log where action = 'purge'`)).rows;
assert.equal(purge.actor, '김구매');
assert.equal(purge.snapshot.shipment_no, 'SH-01');

// 10) 잘못된 코드 5회 → 맞는 코드도 잠시 거부
for (let i = 0; i < 5; i++) await as(U2, `select join_team('nope')`);
assert.equal((await as(U2, `select join_team('test-code-1234') ok`))[0].ok, false);

// 11) 코드 변경 시 기존 팀원 해제
await db.query(`select set_access_code('new-code-5678')`);
assert.equal((await as(U1, `select * from shipments`)).length, 0);

const actions = (await log()).map((l) => `${l.action}:${l.field ?? ''}`);
// 한 번의 수정 안에서 필드 순서는 jsonb 키 순서라 정렬해서 비교
assert.deepEqual([...actions].sort(), [
  'create:', 'status_change:status', 'update:etd', 'inbound_complete:status', 'update:inbound_date',
  'delay_confirm:delay_confirmed', 'update:delay_reason', 'update:delay_stage', 'update:priority', 'update:logistics_eta', 'update:exception_id', 'exception_type_add:',
  'create:', 'trash:location', 'purge:',
].sort());
assert.equal((await log()).find((l) => l.field === 'exception_id').new_value, 'On Hold');
// 읽기 토큰: 맞는 토큰만 조회 가능, 수정 불가, 휴지통 제외, 민감 칸 미포함
await assert.rejects(() => anonRpc('wrong'), /invalid token/);
await assert.rejects(() => anonRpc(null), /invalid token/);
const sched = await anonRpc('test-token');
assert.ok(Array.isArray(sched) && sched.length > 0);
assert.ok(sched.every((x) => x.location !== 'trashed' && !('created_by' in x) && !('remark' in x)));
await assert.rejects(async () => { await db.exec('reset role; set role anon;'); try { await db.query(`select * from read_tokens`); } finally { await db.exec('reset role'); } }, /permission denied/);

// 물류 예상 입고일 자동값(ETA+5): 입력 시 채움, ETA 변경 따라감, 직접 고친 값은 유지
{
  const q = async (sql, p = []) => (await db.query(sql, p)).rows.map((r) => ({ ...r, logistics_eta: r.logistics_eta instanceof Date ? r.logistics_eta.toISOString().slice(0, 10) : r.logistics_eta }));
  const [a] = await q(`insert into shipments (shipment_no, eta, created_by, updated_by) values ('AUTO-1', '2026-12-01', 'x', '') returning *`);
  assert.equal(a.logistics_eta, '2026-12-06');
  let [u] = await q(`update shipments set eta = '2026-12-10' where id = $1 returning *`, [a.id]);
  assert.equal(u.logistics_eta, '2026-12-15');
  [u] = await q(`update shipments set logistics_eta = '2026-12-31' where id = $1 returning *`, [a.id]);
  [u] = await q(`update shipments set eta = '2026-12-20' where id = $1 returning *`, [a.id]);
  assert.equal(u.logistics_eta, '2026-12-31', '직접 고친 값은 유지');
  const [n] = await q(`insert into shipments (shipment_no, created_by, updated_by) values ('AUTO-2', 'x', '') returning *`);
  assert.equal(n.logistics_eta, null);
  [u] = await q(`update shipments set eta = '2026-12-01' where id = $1 returning *`, [n.id]);
  assert.equal(u.logistics_eta, '2026-12-06', '비어 있으면 ETA 입력 시 채움');
}

console.log('schema OK —', actions.length, 'activity rows verified');
