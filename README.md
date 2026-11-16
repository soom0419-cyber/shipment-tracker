# Shipment Tracker — 운영 가이드

구매팀이 상품·샘플 수입 Shipment를 함께 관리하는 웹앱입니다. 두 명 이상이 같은 데이터를 실시간으로 보고 고칩니다.

- **사이트:** https://soom0419-cyber.github.io/shipment-tracker/
- **사용 범위:** 구매팀 내부 전용. 주소와 팀 접속 코드는 메신저로 따로 전달하고, 이메일·공용 문서에 함께 적지 않습니다.

---

## 1. 폴더 구조

```
shipment-tracker/
├─ .github/workflows/pages.yml   main 에 푸시 → DB 점검 + 빌드 → GitHub Pages 배포
├─ supabase/
│  ├─ schema.sql                 처음 한 번 실행하는 전체 DB 구조
│  ├─ migrations/002_*.sql       이후 DB 변경분 (순서대로 실행)
│  ├─ cleanup-before-launch.sql  운영 시작 전 테스트 데이터 정리 (한 번만)
│  └─ test-schema.mjs            로컬 DB로 권한·이력·충돌·영구 삭제 자동 점검
├─ src/
│  ├─ App.tsx        입장 화면 (이름 + 팀 접속 코드)
│  ├─ Tracker.tsx    메인 화면: 메뉴, 대시보드, 검색·필터, 테이블, 충돌 안내
│  ├─ Cell.tsx       셀 표시·편집, 메일 체인, 행 메뉴(⋯)
│  ├─ NewRow.tsx     신규 입력 행 + Draft(브라우저 저장)
│  ├─ Dialogs.tsx    지연 등록·입고 완료·영구 삭제 확인 창
│  ├─ Activity.tsx   변경 이력 문구, Activity 목록, 알림(종)
│  ├─ delay.ts       지연 판단 규칙 (자체 점검 포함)
│  ├─ excel.ts       Excel 내보내기
│  ├─ columns.ts     컬럼 정의(순서·폭·고정)와 입력 검사
│  ├─ api.ts         Supabase 연결과 조회·저장 함수
│  └─ types.ts, styles.css, main.tsx
└─ .env.example      로컬 실행용 환경 변수 예시
```

## 2. 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 화면 | React 18 + TypeScript + Vite |
| DB·실시간 | Supabase (PostgreSQL, 서울 리전 `ap-northeast-2`), Realtime |
| 접속 | Supabase 익명 로그인 + 팀 접속 코드(서버에서 확인) |
| 호스팅 | GitHub Pages (공개 저장소 `soom0419-cyber/shipment-tracker`) |
| Excel | SheetJS `xlsx` 0.18.5 (내보내기만 사용, 처음 누를 때 불러옴) |

## 3. 데이터베이스 구조

| 테이블 | 내용 |
|---|---|
| `shipments` | Shipment 1건 = 1행. 기본 정보, 진행 상태(7단계), 예외 상태, 지연 정보(확정 여부·사유·ETD/ETA 구분), 입고일, 메일 링크 목록, 위치(목록/Archive/Trash) |
| `exception_types` | 예외 상태 목록. 기본 On Hold·Cancelled + 사용자 추가 |
| `activity_log` | 변경 이력. **트리거가 자동 기록**, 화면·공개 키로는 수정·삭제 불가. 영구 삭제 시 직전 값 전체를 보존 |
| `app_secret`, `members`, `join_attempts` | 접속 코드(해시)와 입장한 브라우저 목록. 화면에서 읽을 수 없음 |

- 화면은 `shipments`를 **직접 수정할 수 없고**, `update_shipment` 함수로만 고칩니다. 이 함수가 "편집을 시작할 때의 값"과 현재 값을 비교해서, 다른 사람이 먼저 바꿨으면 저장하지 않고 충돌을 알려 줍니다.
- 영구 삭제는 `purge_shipment` 함수로만 가능하고, Trash에 있는 건만 지울 수 있습니다.
- 메뉴 구분: 진행 중 = 위치 '목록' + 입고 완료 전 / Completed = 위치 '목록' + 창고 입고 완료 / Archive·Trash = 위치 값.

## 4. 주요 기능

- **목록:** 가로 테이블. 고정 컬럼 5개(번호·BL/AWB·SHIP MODE·출발 국가·진행 상태), 휴대폰에서는 번호 1개만 고정. 기본 정렬은 ETD 오름차순(빈 값은 맨 아래), 헤더를 누르면 정렬.
- **등록·수정:** `+ 신규`로 목록에 입력 행이 생기고, 작성 중 내용은 이 브라우저에만 자동 저장(Draft). 셀을 누르면 바로 수정하고 Enter·다른 곳 클릭·드롭다운 선택 시 자동 저장. Remark는 Ctrl+Enter.
- **상태:** 진행 상태 7단계, Booking은 상태에서 자동 표시. BL/AWB가 있으면 '선적 완료' 변경을 **제안만** 함.
- **지연:** 아래 규칙으로 '지연 후보'를 표시하고, 확정은 사람이 함(사유 필수). 지연된 단계를 넘어가면 해제를 제안.
  - ETD 후보: 선적 예정·부킹 대기·부킹 완료인데 ETD가 오늘(한국 시간)보다 이전
  - ETA 후보: 선적 완료·운송 중인데 ETA가 오늘보다 이전
  - 예외 상태가 있거나 입항 완료 이후면 감지하지 않음
- **입고 완료:** 입고일 확인 창을 거쳐 Completed로 이동, 8초 동안 되돌리기 가능.
- **Archive·Trash:** 언제든 복구 가능(읽기 전용). 영구 삭제는 Trash에서 번호를 입력해야 실행.
- **Activity·알림:** 메인 하단에 최근 5개, Activity 메뉴에 전체. 번호를 누르면 해당 행으로 이동해 강조. 알림은 다른 팀원의 신규 등록·상태 변경·지연 확정·입고 완료만.
- **Excel:** '현재 검색·필터 결과' 또는 '전체(Trash 제외)'. 화면 컬럼 순서, 날짜 `YYYY.MM.DD`, 천 단위 구분 유지. 이력은 포함하지 않음.
- **연결 끊김:** 배너를 띄우고 수정을 막음. 다시 연결되면 자동으로 불러옴. 저장 실패 시 '다시 시도' 버튼.

## 5. 환경 변수

| 이름 | 값 | 어디에 |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<프로젝트>.supabase.co` | 로컬 `.env`, GitHub 저장소 **Variables** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | 로컬 `.env`, GitHub 저장소 **Variables** |

두 값은 공개되어도 되는 값입니다. **`sb_secret_...`(관리자 키)와 DB 비밀번호는 절대 `.env`·코드·채팅에 넣지 않습니다.** (백업 자동화 때 GitHub **Secrets**에만 넣습니다.)

## 6. 로컬 실행

```bash
cd C:\Users\-\shipment-tracker
npm install
copy .env.example .env      # 값 채우기
npm run dev                 # http://localhost:5173
npm run test:db             # DB 구조 자동 점검
npm run build               # 타입 검사 + 배포용 빌드
```

## 7. 배포

- `main` 브랜치에 푸시하면 GitHub Actions가 자동으로 **DB 점검 → 빌드 → 배포**합니다(약 1분). 점검이나 빌드가 실패하면 배포되지 않고 기존 사이트가 그대로 유지됩니다.
- 진행 상황: 저장소 → Actions 탭 → "Deploy Pages".
- **DB 구조를 바꿀 때:** `supabase/migrations/00N_설명.sql`을 새로 만들고, `schema.sql`에도 같은 내용을 반영하고, `test-schema.mjs`의 마이그레이션 목록에 추가합니다. 코드 배포 **전에** Supabase SQL Editor에서 마이그레이션을 실행합니다.

## 8. 운영 절차

**팀 접속 코드 바꾸기** (팀원 변경, 코드 유출 의심 시)
1. Supabase → SQL Editor에서 `select set_access_code('새 코드');` 실행 (12자 이상 권장, 작은따옴표 금지)
2. 실행한 쿼리는 SQL Editor 목록에서 삭제
3. 모든 브라우저가 즉시 차단되며, 팀원은 새 코드로 다시 입장

**새 팀원 / 새 PC:** 주소 접속 → 이름 + 코드 입력. Draft와 알림 읽음 표시는 브라우저마다 따로입니다.

**운영 시작 직전 (한 번만):** `supabase/cleanup-before-launch.sql`을 SQL Editor에서 실행 → 테스트 Shipment·이력·추가 예외 상태 삭제. 결과가 `0 / 0 / 2`면 정상.

## 9. 백업 및 복구

| 단계 | 상태 | 복구 방법 |
|---|---|---|
| ① 앱 안 복구 | **사용 중** | Archive·Trash에서 복구, Activity에서 변경 전 값 확인 |
| ② Supabase 일일 백업 (7일) | **미설정** — Pro 전환(월 $25) 후 자동 | Supabase → Database → Backups에서 날짜 선택 복원 (그 이후 변경은 사라짐) |
| ③ 외부 일일 백업 (90일, 비공개 저장소 `shipment-tracker-backup`) | **미설정** | 백업 파일을 SQL Editor로 되돌림 (개발자 작업) |

> ⚠ 현재(무료 플랜)는 ②·③이 없습니다. 실제 업무 데이터를 넣기 전에 백업을 설정하세요. 그 전까지는 수시로 **Excel → 전체 Shipment**를 내려받아 보관하는 것이 최소한의 대비입니다(이력은 포함되지 않음).
> 무료 플랜은 1주일 동안 사용이 적으면 프로젝트가 일시 정지됩니다(데이터는 유지, Supabase 대시보드에서 다시 켜야 함).

## 10. 주요 테스트 결과 (2026-11-13, 실제 Supabase)

신규 등록, 수정, 동시 수정 충돌(같은 셀은 선택, 다른 셀은 둘 다 저장), 상태 변경, 지연 등록·수정·해제, 입고 완료·되돌리기, Completed 해제, Archive·Trash·복구, 영구 삭제(Trash 외 거부), Activity 기록(이력 삭제 거부 403), 알림, Excel 전체·필터, Draft 저장·복구(저장 전 DB 0건), 새로고침·재접속, 연결 끊김·저장 실패 재시도 — **17개 모두 통과**. 비팀원의 조회·등록, 접속 코드 테이블 조회, 직접 수정은 모두 차단 확인.

한계: 네트워크 오류는 브라우저 신호를 흉내 내 시험함(실제 와이파이 차단은 미시험). 실제 Excel 프로그램 대신 같은 라이브러리로 파일을 다시 읽어 검증함.

## 11. 알려진 제한 사항

- **보안은 팀 접속 코드 하나에 달려 있습니다.** 코드가 새면 조회·수정·영구 삭제가 모두 가능합니다(코드 변경으로 즉시 차단, 이력·백업으로 복구).
- 사이트 주소와 코드 구조는 공개되어 있습니다(데이터·코드값·관리자 키는 없음).
- 이름은 본인 확인이 아닙니다. 같은 이름을 쓰면 서로의 알림이 보이지 않습니다.
- Draft·알림 읽음은 브라우저 단위입니다.
- 저장 실패 상태로 페이지를 닫으면 그 수정은 사라집니다.
- 추가한 예외 상태는 화면에서 지울 수 없습니다(과거 기록 보호).
- 태블릿 세로 화면에서는 고정 컬럼 5개 때문에 스크롤 영역이 좁습니다.

## 12. 향후 개선 후보

- Supabase Pro 전환 + 외부 일일 백업 자동화 (최우선)
- 예외 상태 이름 변경·숨기기
- 상태 변경 제안 규칙 추가 (예: ETA 입력 시 '운송 중')
- Shipment 분할, OC 연결 (데이터 구조는 확장 가능하게 설계됨)
- 개인 계정 로그인 (이름 대신 실제 본인 확인이 필요해지면)
