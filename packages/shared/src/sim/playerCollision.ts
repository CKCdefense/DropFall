/**
 * 플레이어(와 클라이언트 예측)가 부딪히는 것들의 충돌 판정.
 *
 * `World.isBlockedForPlayer`와 클라이언트 `PlayerPredictor`가 **같은 함수**를 쓴다 —
 * 그래서 엔티티 전체(Map)가 아니라 좌표 배열을 받는 최소 구조 타입으로 인자를 받는다.
 * 서버는 `World`가 들고 있는 `BuildingEntity`/`ResourceNodeEntity`/`ColonyEntity`를,
 * 클라이언트는 최근 스냅샷의 `BuildingView`/`ResourceNodeView`/`ColonyView`를 그대로
 * 넘길 수 있다(둘 다 x/y/type/hp 필드를 가지므로 구조적으로 호환된다 — 어댑터 불필요).
 *
 * 몬스터 쪽 충돌(`isBlockedForMonster`)은 건축물을 다루지 않고 코어도 안 막는 등 규칙이
 * 달라서 여기 포함하지 않는다 — `World` 안에 그대로 남는다.
 */
import { HIT_RADIUS, circlesOverlap } from './combat';
import { COLONY_RADIUS } from './colony';
import { coreDistance } from './coreShape';
import { buildingsData, resourcesData, type BuildingType, type ResourceType } from '../data';
import { TILE_SIZE } from '../constants';

export { HIT_RADIUS };

/**
 * 플레이어와 이동 차단 건축물(벽/울타리) 사이의 하드 충돌 판정 반경(px) —
 * 플레이어 자신의 반경(`HIT_RADIUS`)과 건축물 자신의 반경(`TILE_SIZE / 2`)의 합이다.
 * 원-원 충돌은 "두 반경의 합보다 중심 간 거리가 가까우면 겹친다"는 규칙이라, 이
 * 상수 자체가 두 원이 맞닿는 지점을 뜻한다. `HIT_RADIUS`를 별도로 export하는 이유:
 * 클라이언트 디버그 테두리(EntityRenderer)가 플레이어 원과 건축물 원을 각각 그려서
 * "두 원이 닿으면 막힌다"를 그대로 보여주려면, 이 합산을 이루는 두 값 모두 서버와
 * 정확히 같아야 한다(값이 서버/시뮬레이션 쪽과 어긋나면 안 됨).
 */
export const PLAYER_BUILDING_COLLISION_RADIUS = HIT_RADIUS + TILE_SIZE / 2;
/** 플레이어-콜로니 하드 충돌 반경(px). 위와 같은 이유로 두 반경의 합을 상수로 export한다. */
export const PLAYER_COLONY_COLLISION_RADIUS = HIT_RADIUS + COLONY_RADIUS;

interface BlockingBuilding {
  type: BuildingType | string;
  x: number;
  y: number;
}

interface BlockingResourceNode {
  type: ResourceType | string;
  x: number;
  y: number;
  hp: number;
}

interface BlockingColony {
  x: number;
  y: number;
}

/**
 * (x,y)에 플레이어가 있다고 가정했을 때 막혀 있는지 검사한다 — 이동 차단 건축물,
 * 살아있는(hp>0) 자원 노드, 콜로니, 코어(8각 발자국, `coreShape.ts`) 순으로 본다.
 */
export function isPlayerBlocked(
  x: number,
  y: number,
  buildings: Iterable<BlockingBuilding>,
  resourceNodes: Iterable<BlockingResourceNode>,
  colonies: Iterable<BlockingColony>,
): boolean {
  for (const building of buildings) {
    if (!buildingsData[building.type]?.blocksMovement) continue;
    if (circlesOverlap(x, y, building.x, building.y, PLAYER_BUILDING_COLLISION_RADIUS)) {
      return true;
    }
  }
  for (const node of resourceNodes) {
    if (node.hp <= 0) continue; // 고갈된 자리는 통과할 수 있다(docs/backend/39)
    const radius = HIT_RADIUS + (resourcesData[node.type]?.hitRadius ?? 0);
    if (circlesOverlap(x, y, node.x, node.y, radius)) return true;
  }
  for (const colony of colonies) {
    if (circlesOverlap(x, y, colony.x, colony.y, PLAYER_COLONY_COLLISION_RADIUS)) return true;
  }
  // 코어는 원이 아니라 8각 발자국이다(coreShape.ts) — 스프라이트 윤곽 그대로 막는다.
  if (coreDistance(x, y) < HIT_RADIUS) return true;
  return false;
}
