export interface PlayerInputMessage {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
}

/**
 * 발사 요청. 이동 입력과 달리 20Hz(현재 TICK_RATE) 주기가 아니라 클릭할 때마다 1번씩
 * 보내는 이산 이벤트다. 위치/조준각은 서버가 이미 알고 있는 플레이어 상태를 그대로
 * 쓰므로 따로 실어보내지 않는다 — 클라이언트가 조작할 여지를 줄인다.
 */
export interface FireInputMessage {
  weaponId: string;
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
