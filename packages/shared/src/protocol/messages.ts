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
