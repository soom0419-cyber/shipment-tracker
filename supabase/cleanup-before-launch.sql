-- 운영 시작 전 테스트 데이터 정리 (한 번만 실행)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run.
-- 지우는 것: 모든 Shipment, 모든 변경 이력, 사용자가 추가한 예외 상태
-- 남기는 것: 테이블 구조, 기본 예외 상태(On Hold, Cancelled), 접속 코드, 이미 입장한 브라우저
-- ⚠ 되돌릴 수 없습니다. 실제 업무 데이터를 입력하기 '전'에만 실행하세요.

begin;

-- 1) 실행 전 확인용: 지워질 건수
select
  (select count(*) from shipments)                            as shipments,
  (select count(*) from activity_log)                         as activity,
  (select count(*) from exception_types where not is_default) as custom_exceptions;

-- 2) Shipment 삭제 (트리거가 'purge' 이력을 남기므로 이력보다 먼저)
delete from shipments;

-- 3) 사용자 추가 예외 상태 삭제 (기본 2개는 유지)
delete from exception_types where not is_default;

-- 4) 변경 이력 전체 삭제 (화면·공개 키로는 불가능, SQL Editor 에서만 가능)
delete from activity_log;

-- 5) 결과 확인: 0 / 0 / 2 가 나와야 정상
select
  (select count(*) from shipments)       as shipments_left,
  (select count(*) from activity_log)    as activity_left,
  (select count(*) from exception_types) as exception_types_left;

commit;
