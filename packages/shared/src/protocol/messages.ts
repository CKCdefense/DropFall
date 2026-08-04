export interface PlayerInputMessage {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
}

/**
 * 퀵슬롯 선택. 무기 교체가 곧 슬롯 선택이다.
 *
 * 무기 id가 아니라 **슬롯 번호**를 보내는 게 핵심이다 — 서버가 그 칸에 실제로 뭐가
 * 들었는지 보고 판단하므로, 갖고 있지 않은 무기를 주장할 수 없다.
 */
export interface SelectSlotMessage {
  index: number;
}

/**
 * 건축 요청. 그리드 스냅(어느 셀을 가리키는지)은 클라이언트가 계산해서 셀 좌표로
 * 보낸다 — 서버는 좌표 변환 없이 그 셀에 지을 수 있는지만 검증한다. 채집(`harvest`)은
 * 반경 안 가장 가까운 노드에 자동으로 적용되니 별도 좌표가 필요 없어 메시지 타입이
 * 없다(페이로드 없는 이벤트).
 */
export interface BuildInputMessage {
  buildingType: string;
  cx: number;
  cy: number;
}
