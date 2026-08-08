/**
 * 순수 이동 수식. 서버(`World`)와 클라이언트 예측이 **같은 코드**를 쓰기 위해 분리했다
 * (docs/02-tech-spec.md §2.1 — shared/sim은 Phaser/DOM/Node에 의존하지 않는다).
 */

/** px/sec, placeholder — 밸런스 확정 전까지 임의값 */
export const PLAYER_SPEED = 100;

/**
 * 입력 벡터를 -1~1로 clamp하고, 대각선 정규화까지 적용한다.
 * clamp만 하면 (1,1) 같은 대각선 입력이 그대로 통과해 속도가 √2배(약 141%)가 된다.
 */
export function normalizeMoveVector(moveX: number, moveY: number): { moveX: number; moveY: number } {
  let x = Math.min(1, Math.max(-1, moveX));
  let y = Math.min(1, Math.max(-1, moveY));

  const length = Math.hypot(x, y);
  if (length > 1) {
    x /= length;
    y /= length;
  }

  return { moveX: x, moveY: y };
}

/**
 * 정규화된 입력 벡터로 한 스텝(dtSeconds) 이동시킨 결과 좌표를 반환한다.
 * speedMultiplier: 음식 스태미나·아드레날린 배율. 클라이언트 예측도 서버가 동기화해 준
 * 같은 배율을 넘겨야 한다 — 다르면 버프 지속 중 계속 되감긴다(rubber-banding).
 */
export function stepPosition(
  x: number,
  y: number,
  moveX: number,
  moveY: number,
  dtSeconds: number,
  speedMultiplier = 1,
): { x: number; y: number } {
  return {
    x: x + moveX * PLAYER_SPEED * speedMultiplier * dtSeconds,
    y: y + moveY * PLAYER_SPEED * speedMultiplier * dtSeconds,
  };
}
