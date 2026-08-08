import { describe, expect, it } from 'vitest';
import {
  isPlayerBlocked,
  PLAYER_BUILDING_COLLISION_RADIUS,
  PLAYER_COLONY_COLLISION_RADIUS,
} from '../src/sim/playerCollision';

// 코어 발자국(coreShape.ts)에서 확실히 벗어난 좌표 — "아무것도 없으면 안 막힌다"류
// 테스트가 코어 자체에 걸리지 않게 한다.
const FAR_FROM_CORE = { x: 5000, y: 5000 };

describe('isPlayerBlocked', () => {
  it('아무것도 없고 코어에서 멀면 막히지 않는다', () => {
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, [], [], [])).toBe(false);
  });

  it('코어 발자국 안(원점 포함)이면 막힌다', () => {
    expect(isPlayerBlocked(0, 0, [], [], [])).toBe(true);
  });

  it('이동 차단 건축물(wall) 반경 안이면 막힌다', () => {
    const buildings = [{ type: 'wall', x: FAR_FROM_CORE.x, y: FAR_FROM_CORE.y }];
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, buildings, [], [])).toBe(true);
    // 반경 살짝 밖은 안 막힌다.
    expect(
      isPlayerBlocked(
        FAR_FROM_CORE.x + PLAYER_BUILDING_COLLISION_RADIUS + 5,
        FAR_FROM_CORE.y,
        buildings,
        [],
        [],
      ),
    ).toBe(false);
  });

  it('데이터에 없는 건축물 타입은 막지 않는다(정의되지 않은 타입 방어)', () => {
    const buildings = [{ type: 'unknown-type', x: FAR_FROM_CORE.x, y: FAR_FROM_CORE.y }];
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, buildings, [], [])).toBe(false);
  });

  it('살아있는(hp>0) 자원 노드는 막지만 고갈된(hp<=0) 노드는 통과한다', () => {
    const alive = [{ type: 'wood', x: FAR_FROM_CORE.x, y: FAR_FROM_CORE.y, hp: 10 }];
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, [], alive, [])).toBe(true);

    const depleted = [{ type: 'wood', x: FAR_FROM_CORE.x, y: FAR_FROM_CORE.y, hp: 0 }];
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, [], depleted, [])).toBe(false);
  });

  it('콜로니 반경 안이면 막힌다', () => {
    const colonies = [{ x: FAR_FROM_CORE.x, y: FAR_FROM_CORE.y }];
    expect(isPlayerBlocked(FAR_FROM_CORE.x, FAR_FROM_CORE.y, [], [], colonies)).toBe(true);
    expect(
      isPlayerBlocked(
        FAR_FROM_CORE.x + PLAYER_COLONY_COLLISION_RADIUS + 5,
        FAR_FROM_CORE.y,
        [],
        [],
        colonies,
      ),
    ).toBe(false);
  });
});
