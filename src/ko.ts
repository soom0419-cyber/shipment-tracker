// 화면 표시용 한글 이름. DB 값(SEA, Product, On Hold, ETD 등)은 그대로 두고 보여 줄 때만 바꾼다.
const MAP: Record<string, Record<string, string>> = {
  ship_mode: { SEA: '해상', AIR: '항공', DHL: '특송(DHL)' },
  shipment_type: { Product: '상품', Sample: '샘플' },
  exception: { 'On Hold': '보류', Cancelled: '취소' },
  delay_stage: { ETD: '출항', ETA: '도착' },
};

// 필드 값 → 한글 (사전에 없으면 원래 값: 사용자가 추가한 예외 상태 등)
export const ko = (field: string, v: string | null | undefined) => (v == null ? '' : MAP[field]?.[v] ?? v);
