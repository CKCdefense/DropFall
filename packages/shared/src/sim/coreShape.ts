/**
 * 코어의 바닥 발자국(충돌 모양).
 *
 * 코어 스프라이트는 128px 캔버스에 8각 받침대가 3/4 시점으로 그려져 있고, 네 귀퉁이는
 * 투명이다. 원 반경 하나로 판정하면 어느 쪽이든 어긋난다 — 반경을 옆구리(±52px)에
 * 맞추면 위아래로 투명 픽셀까지 막고, 위아래에 맞추면 옆구리를 파고들 수 있다.
 *
 * 그래서 **스프라이트의 불투명 윤곽을 실측해 8각형으로 넣었다**(행별 좌우 끝을 재서
 * 월드 좌표로 변환). 시점 때문에 세로가 눌린 비대칭 8각형이다 — 좌표는 코어 원점(0,0)
 * 기준 월드 px이고, 렌더 배율(CORE_SCALE)을 바꾸면 여기도 다시 재야 한다.
 */

/** 8각형 꼭짓점(시계방향). x는 좌우 대칭, y는 시점 때문에 위(-46)가 아래(+8)보다 깊다. */
const FOOTPRINT: readonly (readonly [number, number])[] = [
  [-24, -46],
  [24, -46],
  [52, -26],
  [52, -12],
  [24, 8],
  [-24, 8],
  [-52, -12],
  [-52, -26],
];

/**
 * 점에서 코어 발자국까지의 거리(px). 안쪽이면 0.
 *
 * 반경 더하기 문제를 거리 비교 문제로 바꾼다 — "반지름 r인 원이 코어와 겹치나"는
 * `coreDistance(x, y) < r`이고, "코어 옆인가"는 `coreDistance(x, y) <= 여유`다.
 * 소비자마다 반경 상수를 따로 두던 것을 전부 이 함수 하나로 모은다.
 */
export function coreDistance(x: number, y: number): number {
  // 볼록 다각형: 모든 변의 왼쪽(시계방향 기준 안쪽)에 있으면 내부다.
  let inside = true;
  let nearestSquared = Infinity;

  for (let i = 0; i < FOOTPRINT.length; i += 1) {
    const [ax, ay] = FOOTPRINT[i]!;
    const [bx, by] = FOOTPRINT[(i + 1) % FOOTPRINT.length]!;

    const edgeX = bx - ax;
    const edgeY = by - ay;
    // 시계방향 다각형에서 cross > 0이면 점이 변의 바깥쪽이다.
    if (edgeX * (y - ay) - edgeY * (x - ax) > 0) inside = false;

    // 점→선분 최단거리(제곱). 바깥일 때의 거리 계산에 쓴다.
    const lengthSquared = edgeX * edgeX + edgeY * edgeY;
    const t = Math.max(0, Math.min(1, ((x - ax) * edgeX + (y - ay) * edgeY) / lengthSquared));
    const dx = x - (ax + edgeX * t);
    const dy = y - (ay + edgeY * t);
    const distSquared = dx * dx + dy * dy;
    if (distSquared < nearestSquared) nearestSquared = distSquared;
  }

  return inside ? 0 : Math.sqrt(nearestSquared);
}

/** 코어 상호작용(E·제작·상점) 여유 거리(px). 발자국 가장자리에서 이만큼까지 허용한다. */
export const CORE_INTERACT_MARGIN = 32;

/** 코어 옆에서 상호작용할 수 있는가. 서버 판정과 클라이언트 안내가 같은 함수를 쓴다. */
export function isWithinCoreInteract(x: number, y: number): boolean {
  return coreDistance(x, y) <= CORE_INTERACT_MARGIN;
}
