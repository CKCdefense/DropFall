import { MAP_ORIGIN, MAP_SIZE_TILES, TILE_SIZE, cellCenterWorld, worldToCell } from '../constants';
import {
  buildingsData,
  coloniesData,
  companionData,
  corePersonaData,
  coreUpgradesData,
  craftingData,
  itemsData,
  shopData,
  loadoutData,
  monstersData,
  resourcesData,
  wavesData,
  weaponsData,
  type BuildingType,
  type DropRange,
  type MeleeAttackData,
  type MeleeHitData,
  type MonsterData,
  type CraftRecipe,
  type ItemKind,
  type ItemRarity,
  type MonsterType,
  type ResourceType,
} from '../data';
import type { PlayerInputMessage } from '../protocol/messages';
import { FlowField, type FlowFieldGrid } from './ai/flowField';
import { BuildingRegistry, type BuildingEntity } from './building';
import {
  COLONY_RADIUS,
  ColonyRegistry,
  colonyStageData,
  maxColonyStage,
  type ColonyEntity,
} from './colony';
import { createCompanion, type CompanionEntity } from './companion';
import {
  applyPersonaEvent,
  createInitialPersonaTraits,
  type CorePersonaTraits,
  type PersonaEvent,
} from './corePersona';
import {
  applyCompanionPersonaEvent,
  createInitialCompanionTraits,
  type CompanionPersonaEvent,
  type CompanionPersonaEventKind,
  type CompanionPersonaTurn,
} from './companionPersona';
import {
  HIT_RADIUS,
  WeaponCooldowns,
  circlesOverlap,
  resolveFire,
  tickProjectiles,
  withinMeleeArc,
  type MeleeHit,
  type ProjectileEntity,
} from './combat';
import { Inventory } from './inventory';
import { CoreStorage, STORAGE_SLOT_COUNT } from './storage';
import { coreDistance, isWithinCoreInteract } from './coreShape';
import { ExploredMap } from './explored';
import { normalizeMoveVector, stepPosition } from './movement';
import { SpatialGrid } from './spatialGrid';
import { WaveManager, type GamePhase } from './wave';
import { runDevCommand, type DevCommandResult, type DevWorldAccess } from './devCommands';

/** moveItem이 받는 컨테이너 이름. 네트워크 경계를 넘어오므로 값부터 검증한다. */
export type SlotContainer = 'inventory' | 'storage';

function isContainerName(value: unknown): value is SlotContainer {
  return value === 'inventory' || value === 'storage';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 몬스터의 원형 히트박스 반경(px). 타입마다 덩치가 다르므로 데이터에서 읽는다 —
 * 예전에는 전부 고정값(HIT_RADIUS)이라, 작은 몬스터는 몸에서 한참 떨어진 곳에서 맞고
 * 보스는 몸 안쪽까지 들어와야 맞았다.
 */
function monsterRadius(monster: MonsterEntity): number {
  return monstersData[monster.type]?.hitRadius ?? HIT_RADIUS;
}

const FLOW_FIELD_GRID: FlowFieldGrid = {
  widthInTiles: MAP_SIZE_TILES,
  heightInTiles: MAP_SIZE_TILES,
  tileSize: TILE_SIZE,
  originX: MAP_ORIGIN,
  originY: MAP_ORIGIN,
};
/**
 * 코어 충돌은 반경이 아니라 **8각 발자국**(coreShape.ts)으로 판정한다. 스프라이트가
 * 3/4 시점 다각형이라 원 하나로는 옆구리를 파고들거나 투명 픽셀까지 막는다 —
 * 모든 코어 거리 판정은 coreDistance() 하나를 쓴다.
 */

/**
 * 바닥 드롭을 주울 수 있는 반경(px). 캐릭터 반경보다 넉넉하게 잡아야 정확히 밟지 않아도
 * 주워진다 — 너무 넓으면 여러 개가 한 번에 사정권에 들어와 "주우러 다니는" 맛이 없어진다.
 */
/**
 * 드롭을 주울 수 있는 거리(px). 클라이언트도 같은 값으로 "지금 주울 게 있나"를 판정해야
 * 코어 앞에서 E가 창고를 열지 아이템을 줍을지 서버와 같은 결론을 낸다.
 */
export const PICKUP_RADIUS = 22;

/**
 * 아무것도 안 들었을 때 쓰는 기본 무기(weapons.json의 key). 손이 비었다고 아무것도
 * 못 하면 도구를 잃었을 때 할 수 있는 게 없어진다 — 대신 데미지가 매우 낮다.
 */
export const BARE_HANDS_WEAPON_ID = 'fist';

/** 개발 커맨드로 몬스터를 부를 때 코어에서 띄우는 거리(px). 바로 옆에 붙여 놓으면 코어가 즉사한다. */
const DEV_SPAWN_RADIUS = 160;

/**
 * 공격 모션을 켜 두는 시간(초). 클라이언트는 이 값이 켜지는 **순간**(false→true)에
 * 공격 애니메이션을 한 번 재생한다 — 그래서 정확한 길이가 아니라 "네트워크로 그 전이가
 * 확실히 전달될 만큼"만 되면 된다. 20Hz 패치 기준 0.4초면 여덟 번쯤 실려 나간다.
 * 가장 짧은 공격 주기(0.8초)보다 짧아야 연속 공격이 한 번으로 뭉치지 않는다.
 */
const ATTACK_ANIM_SECONDS = 0.4;

/** 수호대가 콜로니 곁으로 "도착했다"고 보는 여유 거리(px). 충돌 반경 바로 바깥이다. */
const GUARD_HOME_ARRIVE_MARGIN = 10;
/** 이 거리보다 가까운 몬스터끼리는 서로 밀어낸다 — 군집 분리(기술명세 §5.3). */
const SEPARATION_RADIUS = HIT_RADIUS * 2.5;
/**
 * 몬스터 공간 분할 격자(SpatialGrid)의 칸 크기(px). `SEPARATION_RADIUS`(=25px)나
 * 흔한 투사체 히트 판정 반경보다 넉넉히 크게 잡아서, 질의 반경이 한두 칸 안에서
 * 끝나게 한다(너무 작으면 질의마다 훑는 칸 수가 늘어 이득이 줄어든다).
 */
const MONSTER_GRID_CELL_SIZE = 64;
/**
 * 몬스터 타입별 히트박스 반경(`monsterRadius`)의 최댓값. 그리드 질의 반경에 이 값을
 * 더해야, 큰(보스급) 몬스터가 질의 중심에서 격자 반경만큼 떨어져 있어도(중심은
 * 범위 밖이지만 몸이 걸치는 경우) 후보에서 빠뜨리지 않는다.
 */
const MAX_MONSTER_HIT_RADIUS = Math.max(
  HIT_RADIUS,
  ...Object.values(monstersData).map((data) => data.hitRadius ?? HIT_RADIUS),
);
/** 분리력이 주 이동 방향을 완전히 덮어쓰지 않도록 두는 가중치. */
const SEPARATION_WEIGHT = 0.6;
/** 한 번 잡은 어그로 타겟은 아그로 반경의 이 배수를 벗어나기 전까진 유지한다(타겟 떨림 방지). */
const AGGRO_LEASH_MULTIPLIER = 1.5;
/**
 * 몬스터가 완전히 자유롭게(폴백 없이) 움직이지 못한 채 이 시간(초) 이상 이어지면
 * 탈출 점프를 시도한다(docs/backend/42). 정상적인 장애물 모서리 우회(축 슬라이딩/
 * 접선 미끄러짐)는 보통 1초 안에 끝나므로, 그보다 살짝 여유를 둬서 정상 우회
 * 도중에 불필요하게 끼어들지 않게 한다.
 */
const STUCK_ESCAPE_SECONDS = 1.5;
/** 탈출 점프 거리(px) — 자원 노드/콜로니 키프아웃 반경보다 확실히 크게 잡아 한 번에 벗어나게 한다. */
const STUCK_ESCAPE_DISTANCE = 40;
/** 탈출 점프 각도 재시도 횟수. world.ts의 다른 배치 재시도(`pickClusterNodePosition` 등)와 같은 값. */
const STUCK_ESCAPE_ATTEMPTS = 8;
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
/** 플레이어-코어 하드 충돌 반경(px). 위와 같은 이유로 두 반경의 합을 상수로 export한다. */

/** 플레이어-콜로니 하드 충돌 반경(px). */
export const PLAYER_COLONY_COLLISION_RADIUS = HIT_RADIUS + COLONY_RADIUS;
export { HIT_RADIUS };
/**
 * 몬스터가 "처음" 플레이어를 발견할 때만 적용하는 시야각(120도, 바라보는 방향 기준 ±60도).
 * cos(60°)=0.5 — 내적(dot product)이 이 값 이상이면 시야각 안이다. atan2/acos 없이 내적
 * 하나로 판정할 수 있어 후보 플레이어 수만큼 곱셈 몇 번이면 끝난다(이미 거리 계산에 쓰는
 * hypot 외에 추가 삼각함수 호출이 없다).
 *
 * 한 번 타겟을 잡은 뒤(leash 유지 중)에는 이 조건을 다시 걸지 않는다 — 몬스터가 등 뒤로
 * 돌아간 플레이어를 갑자기 놓치면 오히려 더 부자연스럽다. "발견"에만 걸고 "추격 유지"엔
 * 안 거는 게 사람이 느끼기에도, 게임 로직으로도 자연스럽다.
 */
const AGGRO_FOV_COS_HALF_ANGLE = Math.cos(Math.PI / 3);
/**
 * 보스가 스폰된 직후 특수 패턴(돌진/광역)을 처음 쓸 수 있게 되기까지의 유예 시간(초).
 * 스폰하자마자 바로 예고 없이(사실은 예고가 있지만) 패턴을 쓰면 플레이어가 상황을
 * 파악하기도 전에 위협이 시작돼 불공평하게 느껴진다.
 */
const BOSS_FIRST_PATTERN_DELAY = 3;

/**
 * 자원 노드 배치(플레이스홀더, docs/backend/26). 한 지점에 몰아서 "군집"으로 배치한다 —
 * 낮 시간에 "저 방향에 나무숲/채석장이 있었지" 하고 기억해서 찾아가는 경험을 노린다.
 * 클러스터 중심은 코어를 기준으로 [MIN,MAX] 반경 띠 안에서 무작위로 고르고, 그 중심
 * 주변 `CLUSTER_JITTER_RADIUS` 안에 노드를 흩뿌린다. 총 개수(클러스터 수 × 클러스터당
 * 개수)는 기존 고정 원 배치(나무 10/돌 6)와 같게 맞췄다 — 이번 변경은 "어디에 있는지"만
 * 바꾸고 "얼마나 있는지"(밸런스)는 건드리지 않는다.
 */
const WOOD_CLUSTER_COUNT = 2;
const WOOD_NODES_PER_CLUSTER = 5;
const STONE_CLUSTER_COUNT = 2;
const STONE_NODES_PER_CLUSTER = 3;
/**
 * 클러스터 중심이 코어로부터 떨어져야 하는 최소/최대 거리(px). 맵 자체는 훨씬
 * 크지만(MAP_SIZE_TILES 기준 코어에서 최대 1024px), 그 전체를 다 쓰면 낮 시간
 * 안에 왕복하기엔 너무 멀다 — 밤 웨이브/콜로니 스폰 반경(900px, backend/35)
 * 안쪽으로만 좁혀서, 위험을 살짝 감수하는 정도의 거리로 맞췄다.
 *
 * 최소 거리는 **코어 업그레이드 전 기본 건설 가능 반경**(`coreUpgradesData.
 * baseBuildRadius`=250px, backend/38)보다 넉넉히 멀리 뒀다 — 안 그러면 자원
 * 군집이 코어 바로 코앞까지 파고들어서 건축은 물론 그냥 이동조차 불편해진다
 * (실제로 250 이하였을 때 이 문제가 보고됐다, docs/backend/39).
 */
const CLUSTER_MIN_DISTANCE = 260;
const CLUSTER_MAX_DISTANCE = 500;
/** 클러스터 중심 주변으로 노드가 흩어지는 반경(px). */
const CLUSTER_JITTER_RADIUS = 80;
/**
 * 같은 클러스터 안에서 노드끼리 이 거리보다 가깝게는 두지 않는다(완전히 겹치는 것
 * 방지). 자원 노드를 근접 타격 대상으로 바꾸면서 판정 반경(resourcesData.hitRadius,
 * 14px)에 맞춰 시각적으로도 커졌다 — 간격이 그보다 좁으면 옆 노드와 그림이 겹친다.
 */
const MIN_NODE_SPACING = 36;

export interface PlayerEntity {
  id: string;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
  hp: number;

  /** 흔한 몬스터(잡몹/돌진/탱커) 처치로 받는 휴대 자원. 나무/돌과 동일하게 코어에
   * 입고(E)해야 팀 공유(coreSharedScrap)가 된다. */

  /** 퀵슬롯. 장착 무기도 여기서 나온다 — 클라이언트가 무기를 주장할 수 없다. */
  inventory: Inventory;
  /** 이번 틱에 몬스터에게 맞았는지. 매 틱 시작 시 초기화되고, damagePlayer()가 세팅한다. */
  tookDamageThisTick: boolean;
}

export interface ResourceNodeEntity {
  id: string;
  type: ResourceType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 0이면 채집 가능(살아있음). 고갈되면 resourcesData[type].respawnSeconds로 세팅되고 매 틱 감소한다. */
  respawnTimer: number;
  /**
   * 이 노드가 속한 군집(클러스터) 중심 좌표. 리스폰될 때 같은 군집 안에서만 새
   * 위치를 고르기 위해 기억해 둔다 — x/y 자신은 리스폰마다 바뀌지만 이 값은
   * 노드가 존재하는 내내 고정이다.
   */
  clusterX: number;
  clusterY: number;
}

/**
 * 바닥에 떨어진 아이템. 자원 노드를 완전히 부수면 생긴다.
 *
 * 예전에는 노드를 부순 순간 채집자의 지갑에 자원이 꽂혔다. 드롭을 거쳐야 "부수는 일"과
 * "줍는 일"이 나뉘어서, 밤이 오면 못 주운 자원을 두고 도망칠지 같은 선택이 생긴다.
 */
export interface DroppedItemEntity {
  id: string;
  itemId: string;
  count: number;
  x: number;
  y: number;
}

/**
 * 보스 전용 특수 공격 패턴(돌진/광역)의 상태 머신. 일반 몹은 항상 `{ kind: 'idle' }`로
 * 고정이다 — `chargeAttack`/`slamAttack` 데이터가 없는 타입은 `tickBossPattern`이
 * 첫 검사에서 바로 false를 반환하므로 이 상태를 실제로 오갈 일이 없다.
 *
 * idle → (chargeTelegraph → charging | slamTelegraph) → idle 순으로만 전이한다.
 * 예고(Telegraph) 상태의 값(방향/지점)은 예고 "시작 시점"에 한 번 고정된다 — 그래야
 * 화면에 미리 보여준 위험 범위와 실제로 피해가 들어가는 범위가 정확히 일치한다(타겟이
 * 예고 도중 움직여도 범위가 따라가면 "본 대로 피했는데 맞는" 상황이 생긴다).
 */
export type BossPatternState =
  | { kind: 'idle' }
  | { kind: 'chargeTelegraph'; timer: number; total: number; dirX: number; dirY: number }
  | { kind: 'charging'; timer: number; dirX: number; dirY: number; hitPlayerIds: Set<string> }
  | { kind: 'slamTelegraph'; timer: number; total: number; x: number; y: number }
  /**
   * 근접 검술 진행 중. 바닥 표시 없이 **동작 자체가 예고**라(무기를 치켜드는 프레임),
   * 클라이언트가 어느 동작을 재생할지 알 수 있게 `index`(meleeAttacks 배열 위치)를
   * 들고 있는다.
   *
   * 동작 하나가 타격 하나는 아니다 — 흑기사 1번 기술처럼 2연타가 있어서, 경과 시간
   * (`elapsed`)을 재면서 아직 안 터진 타격(`nextHit`)의 시점을 넘길 때마다 판정한다.
   */
  | {
      kind: 'meleeSwing';
      elapsed: number;
      index: number;
      nextHit: number;
      dirX: number;
      dirY: number;
    }
  /** 판정 후 경직. 이 동안은 이동도 다음 공격도 없다 — 플레이어가 반격할 틈이다. */
  | { kind: 'meleeRecover'; timer: number };

export interface MonsterEntity {
  id: string;
  type: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  /** 현재 추격 중인 플레이어 id(어그로 있는 타입만). 히스테리시스로 타겟을 유지하는 데 쓴다. */
  targetPlayerId?: string;
  /**
   * 바라보는 방향(단위 벡터). 이동/공격 로직이 이미 계산해 둔 방향 벡터를 그대로 재사용해서
   * 매 틱 갱신한다 — 새로 삼각함수를 호출하지 않는다. 시야각 기반 어그로 판정(§AGGRO_FOV)에 쓴다.
   */
  facingX: number;
  facingY: number;
  /** 보스 전용 특수 패턴 상태(§BossPatternState). 일반 몹은 항상 idle이다. */
  pattern: BossPatternState;
  /** 다음 특수 패턴을 쓸 수 있게 되기까지 남은 시간(초). chargeAttack/slamAttack이 없는 타입은 쓰지 않는다. */
  specialAttackCooldown: number;
  /**
   * `moveMonster`가 이동을 전혀 못 시킨 채(축 슬라이딩·접선 미끄러짐까지 다 막힘)
   * 연속으로 흐른 시간(초). 이동에 성공하면 0으로 리셋된다. 자원 노드 여러 개가
   * 촘촘히 둘러싼 "주머니"에 갇히면 계속 쌓이는데, 임계값을 넘으면 탈출 점프를
   * 시도한다(docs/backend/42) — 이게 없으면 그런 위치에서 영원히 못 움직인다.
   */
  stuckSeconds: number;
  /**
   * 티모시(AI 동반자) 공격 쿨다운(초). 플레이어 공격 쿨다운(attackCooldown)과 별도로 둔다 —
   * 같은 틱에 플레이어와 티모시가 둘 다 사거리 안에 있어도 서로의 쿨다운에 영향을 주지
   * 않게 하기 위해서다. 정식 추격 대상(targetPlayerId)과 달리 단순 근접 판정이라
   * 히스테리시스/시야각 없이 매 틱 거리만 본다(docs/superpowers/specs/
   * 2026-08-07-ai-companion-timothy-design.md).
   */
  companionAttackCooldown: number;
  /**
   * 콜로니 수호대라면 소속 콜로니 id. 있으면 코어 침공 AI 대신 수호 AI를 탄다 —
   * 리시 반경 안의 플레이어만 공격하고, 아무도 없으면 콜로니로 귀환해 저장 상태로
   * 복귀한다(stored 복원). 웨이브/침공 복제 몬스터는 undefined다.
   */
  homeColonyId?: string;
  /** 수호대 전용: 콜로니 곁에 도착한 뒤 저장 상태로 복귀하기까지 누적된 대기(초). */
  guardReturnTimer: number;
  /**
   * 근접 검술별 남은 쿨다운(초). meleeAttacks 배열과 같은 순서다 — 기술마다 따로
   * 돌아야 "멀면 찌르기, 붙으면 내려치기"처럼 거리에 따라 다른 기술이 나온다.
   */
  meleeCooldowns: number[];
  /**
   * 지금 재생해야 할 공격 동작 번호(0=없음, 1~3=Attack01~03). 잡몹은 항상 1이고,
   * 검술이 여러 개인 보스만 값이 갈린다.
   */
  attackAnim: number;
  /**
   * 공격 모션이 남은 시간(초). 실제로 피해를 넣은 순간 ATTACK_ANIM_SECONDS로 채워지고
   * 매 틱 줄어든다. 전투 판정에는 전혀 쓰지 않는다 — 클라이언트가 공격 애니메이션을
   * 재생할 시점을 알려주기 위해서만 존재한다(그림 없이는 알 방법이 없다).
   */
  attackAnimTimer: number;
}

export interface CoreState {
  hp: number;
  maxHp: number;
  /**
   * 팀 전체가 공유하는 자원 창고. 플레이어 개인의 wood/stone은 "아직 코어에 입고하지
   * 않은, 손에 든" 양이고, 건축 비용은 여기(공유 자원)에서만 나간다 — 자원을 모아서
   * 함께 쓰는 협동 경험을 만들려는 의도다(자원채집 도구 도입에 맞춰 재설계, 이전엔
   * 채집 즉시 개인 지갑에 꽂혔었다).
   */
  /**
   * 팀 공용 창고. 예전의 sharedWood/sharedStone/sharedScrap 숫자 필드를 대체한다 —
   * 자원 종류가 늘 때마다 필드를 추가할 필요가 없고(몬스터 드랍이 그 예다), 도구도 같은
   * 방식으로 보관할 수 있다. 특정 재료 개수는 storage.countOf로 묻는다.
   */
  storage: CoreStorage;
  /**
   * 팀 공용 자금. 몬스터 드랍을 상점에 팔아 번다 — 재료(창고)와 돈을 나눈 이유는
   * "짓는 자원"과 "사는 자원"의 쓰임이 달라서다. 건축은 창고에서, 구매는 여기서 나간다.
   */
  money: number;
  /**
   * 콜로니 파괴 또는 보스 처치로만 얻는 희귀 자원. 나무/돌과 달리 "채집 후 입고"
   * 단계가 없다 — 획득 즉시 팀 전체 몫으로 귀속된다(누가 잡았든 팀 보상). 코어
   * 업그레이드/상점 구입 전용으로 쓸 예정(아직 그 소비처는 미구현 — CoreModal/
   * UpgradeModal의 "에너지" 플레이스홀더 행이 이 값을 보여줄 자리다).
   */
  sharedEnergy: number;
  /**
   * 구매한 코어 업그레이드 단계(0부터 시작, 미구매 상태). `coreUpgradesData.tiers[tier]`가
   * "다음에 살 단계"를 가리킨다 — `upgradeCore()`가 이 인덱스로 다음 단계 비용/보너스를
   * 조회한 뒤 tier를 1 늘린다.
   */
  tier: number;
  /**
   * 오늘의 상점 진열(아이템 id 목록). 낮이 시작될 때마다 새로 뽑는다 —
   * 고정 진열이면 "돈이 모이면 언젠가 다 산다"가 되어 그날그날의 선택이 사라진다.
   */
  shopStock: string[];
}

let nextMonsterId = 1;
let nextResourceNodeId = 1;
let nextBuildingId = 1;
let nextDropId = 1;

export interface WorldOptions {
  /** 자원 노드 군집 배치에 쓰는 RNG. 테스트에서 결정론적으로 검증하려고 주입한다(wave.ts와 동일 패턴). */
  rng?: () => number;
}

export class World {
  private players = new Map<string, PlayerEntity>();
  private inputs = new Map<string, PlayerInputMessage>();
  private monsters = new Map<string, MonsterEntity>();
  /**
   * `monsters`와 항상 같은 내용을 담고 있어야 하는 공간 분할 인덱스(docs/backend/45).
   * 몬스터가 추가/제거/이동될 때마다(addMonster/damageMonster/moveMonster, monsters를
   * clear()하는 디버그 커맨드들) 같이 갱신한다 — 매 틱 통째로 다시 만들지 않고 계속
   * 살아있는 상태로 들고 가는 이유는 SpatialGrid 클래스 주석 참고.
   */
  private readonly monsterGrid = new SpatialGrid(MONSTER_GRID_CELL_SIZE);
  private projectiles = new Map<string, ProjectileEntity>();
  private readonly cooldowns = new WeaponCooldowns();
  private readonly waveManager = new WaveManager();
  private readonly buildings = new BuildingRegistry();
  /** 코어 AI 페르소나 트레잇. 웨이브 종료/콜로니 파괴/코어 상호작용마다 조금씩 바뀐다. */
  private personaTraits: CorePersonaTraits = createInitialPersonaTraits();
  /** GameRoom이 매 틱 drainPersonaEvents()로 비워가는 큐 — LLM 호출은 여기서 하지 않는다
   * (shared/sim은 fetch 등 Node/DOM API를 쓸 수 없다, docs/02-tech-spec.md §2.1). */
  private pendingPersonaEvents: PersonaEvent[] = [];
  /** 코어 상호작용 트리거의 마지막 발생 시각(elapsedSeconds 기준). 스팸 방지 쿨다운에 쓴다. */
  private lastCoreInteractionAt = -Infinity;
  /** 티모시와 플레이어 사이의 관계 트레잇 — 방 전체가 아니라 플레이어 id별로 따로 쌓인다. */
  private companionTraits = new Map<string, CorePersonaTraits>();
  private pendingCompanionPersonaEvents: CompanionPersonaEvent[] = [];
  /** 티모시 대사(LLM 호출/브로드캐스트) 자체의 방 전역 마지막 발생 시각. 트레잇 누적과는
   * 별개다 — 누가 됐든 너무 자주 말하지 않게만 막는다. */
  private lastCompanionCommentaryAt = -Infinity;
  /** "@티모시 ..." 채팅 전용 쿨다운 시각. 위 잡담 쿨다운과 별개 풀이다(companionPersona.ts 참고). */
  private lastCompanionMessageAt = -Infinity;
  /** "@티모시 ..." 대화 기록 — 플레이어별로 최근 몇 마디만(historyMessageLimit) 세션 동안 들고 있다. */
  private companionConversations = new Map<string, CompanionPersonaTurn[]>();
  /**
   * 쿨다운 중에 들어온 "@티모시 ..." 질문을 버리지 않고 쌓아두는 큐. 쿨다운이 끝나는
   * 즉시(tick마다 확인) 가장 오래된 것부터 하나씩 꺼내 처리한다 — 연달아 두 번 물어보면
   * 두 번째가 조용히 씹히던 문제(실제로 겪음)를 이렇게 고쳤다. 무한정 쌓이지 않게
   * 개수를 제한한다(그래도 넘치면 그건 진짜 스팸으로 보고 거절한다).
   */
  private queuedCompanionMessages: { playerId: string; message: string }[] = [];
  private static readonly MAX_QUEUED_COMPANION_MESSAGES = 3;
  private readonly resourceNodes = new Map<string, ResourceNodeEntity>();
  private readonly droppedItems = new Map<string, DroppedItemEntity>();
  private readonly colonies = new ColonyRegistry();
  /**
   * 이번 밤의 콜로니 침공 복제분 대기열. 밤 시작에 buildNightContingents()가 만들고
   * tickContingents()가 콜로니 방향에서 무리 단위로 내보낸다. 다음 밤 시작에 통째로
   * 교체된다.
   */
  private readonly contingents: { x: number; y: number; queue: MonsterType[]; timer: number }[] =
    [];
  /**
   * AI 동반자("티모시"). 방(팀)당 1마리라 players/monsters처럼 Map으로 관리하지 않는다
   * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md). 코어는 항상
   * 원점(0,0)이라 스폰 위치도 생성자에서 바로 정할 수 있다 — startColonies처럼 인원수를
   * 기다릴 필요가 없다.
   */
  private companion: CompanionEntity = createCompanion(0, 0);
  /**
   * 콜로니가 차지한 그리드 셀("cx,cy" 키) 집합. 콜로니는 위치가 절대 안 바뀌고,
   * 정화돼도 구조물은 남으므로(재설계 후 "파괴" 개념이 없다) 배치 시점
   * (`startColonies`)에 한 번만 계산하면 판이 끝날 때까지 그대로다.
   * FlowField의 `isBlocked` 콜백이 여기 기록된 셀도 같이 막힌 것으로 본다.
   *
   * 코어 자신의 셀은 절대 여기 넣지 않는다 — FlowField의 목표(target) 셀이 막히면
   * `recompute()`가 전체 계산을 포기해버린다(치명적). 몬스터는 어차피
   * 발자국 가장자리에서 attackRange만큼 떨어져 멈춰 코어를 공격하므로 코어 셀까지 들어갈
   * 필요가 없어 막을 이유도 없다 — 코어의 플레이어/투사체 하드 충돌은 이 집합과
   * 무관하게 `isBlockedForPlayer`/`projectileHitsObstacle`이 원점 좌표로 직접 검사한다.
   */
  private readonly colonyObstacleCells = new Set<string>();
  /**
   * 자원 노드가 차지한 그리드 셀 집합. 콜로니와 달리 **위치도 존재 여부도 바뀐다**
   * — 고갈(hp 0)되면 더 이상 막지 않고, 리스폰될 때 같은 군집 안 새 위치로
   * 옮겨간다(docs/backend/39). 그래서 한 번만 캐싱하지 않고, 고갈/리스폰이 일어날
   * 때마다 `rebuildResourceObstacleCells()`로 통째로 다시 계산한다.
   */
  private readonly resourceObstacleCells = new Set<string>();
  private readonly rng: () => number;
  private readonly flowField = new FlowField(
    FLOW_FIELD_GRID,
    (cx, cy) =>
      this.buildings.isBlockedForMovement(cx, cy) ||
      this.colonyObstacleCells.has(`${cx},${cy}`) ||
      this.resourceObstacleCells.has(`${cx},${cy}`),
  );
  private readonly core: CoreState = {
    hp: wavesData.coreHp,
    maxHp: wavesData.coreHp,
    storage: new CoreStorage(),
    money: 0,
    sharedEnergy: 0,
    tier: coreUpgradesData.startTier,
    shopStock: [],
  };
  private elapsedSeconds = 0;
  /** 이번 낮 페이즈에 스킵 투표를 던진 플레이어 id 집합. 만장일치면 skipDay()를 부른다. */
  private skipVotes = new Set<string>();
  /** 팀이 밝힌 지역(explored.ts). 누가 봤든 전원이 공유한다. */
  private readonly explored = new ExploredMap();
  /**
   * 플레이어별로 마지막에 시야를 갱신한 칸. 같은 칸에 서 있는 동안은 다시 계산하지
   * 않는다 — 원형 시야 한 번이 ~450칸이라 매 틱 돌리면 낭비다.
   */
  private readonly lastRevealCell = new Map<string, number>();

  constructor(options: WorldOptions = {}) {
    this.rng = options.rng ?? Math.random;
    // 콜로니는 여기서 아직 안 만든다 — 접속 인원수가 몇 명일지는 생성 시점엔 알 수
    // 없다(서버는 로비가 끝나야 확정된다). 인원이 확정되면 호출자가 startColonies()를
    // 명시적으로 불러야 한다(docs/backend/41).
    this.seedResourceNodes();
    this.rebuildResourceObstacleCells();
    // 정적 장애물 표시가 끝난 뒤에 계산해야 최초 FlowField가 이미 이걸 반영한다.
    // 이 시점엔 콜로니가 없어 colonyObstacleCells도 비어 있다 — startColonies()가
    // 나중에 다시 계산한다.
    this.recomputeFlowField();

    // 도구는 개인이 아니라 팀 창고에서 시작한다 — 누가 무엇을 들지 정하는 것부터가
    // 협동의 첫 결정이다. 인원과 무관하게 한 세트만 들어간다.
    for (const entry of loadoutData.coreStorage) {
      this.core.storage.add(entry.itemId, entry.count);
    }

    // 게임은 낮으로 시작한다 — 첫날 진열도 여기서 뽑아둔다. 둘 다 콜로니(인원수)와
    // 무관하므로 startColonies()가 아니라 생성 시점에 정해진다.
    this.rollShopStock();
  }

  /**
   * 콜로니를 접속 인원수만큼(사분면당 최대 1개, 최대 4개) 무작위 배치한다
   * (docs/backend/41). `World` 생성 시점엔 인원을 몰라서 생성자가 아니라 이 메서드로
   * 분리했다 — 인원이 확정된 바로 그 시점에 호출자가 정확히 한 번 불러야 한다
   * (서버는 로비가 끝나 게임이 실제로 시작될 때, 로컬 모드는 유일한 플레이어를
   * 추가한 직후). 두 번 부르면 사분면당 1개 제약이 깨지므로 호출부가 책임진다.
   */
  startColonies(count: number): void {
    this.colonies.seed(count, this.rng);
    this.rebuildColonyObstacleCells();
    this.recomputeFlowField();
  }

  /**
   * 콜로니의 위치를 기준으로 차단 셀 집합을 계산한다. 배치(`startColonies`) 때 한 번이면
   * 된다 — 재설계 후 콜로니는 파괴되지 않아 존재 여부가 변하지 않는다.
   */
  private rebuildColonyObstacleCells(): void {
    this.colonyObstacleCells.clear();
    for (const colony of this.colonies.values()) {
      const { cx, cy } = worldToCell(colony.x, colony.y);
      this.colonyObstacleCells.add(`${cx},${cy}`);
    }
  }

  /**
   * 살아있는(hp>0) 자원 노드의 현재 위치를 기준으로 차단 셀 집합을 통째로 다시
   * 계산한다. 고갈/리스폰(위치 변경)이 일어날 때마다 호출해야 한다 — 콜로니와
   * 달리 캐싱만 해 두면 안 되는 이유(§resourceObstacleCells)를 그대로 반영한다.
   */
  private rebuildResourceObstacleCells(): void {
    this.resourceObstacleCells.clear();
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈되면 더 이상 막지 않는다
      const { cx, cy } = worldToCell(node.x, node.y);
      this.resourceObstacleCells.add(`${cx},${cy}`);
    }
  }

  addPlayer(id: string, x = 0, y = 0): void {
    const inventory = new Inventory();
    for (const entry of loadoutData.playerStarting) inventory.add(entry.itemId, entry.count);

    this.players.set(id, {
      id,
      x,
      y,
      aimAngle: 0,
      lastProcessedSeq: 0,
      hp: wavesData.playerHp,
      inventory,
      tookDamageThisTick: false,
    });
  }

  removePlayer(id: string): void {
    this.lastRevealCell.delete(id);
    this.players.delete(id);
    this.inputs.delete(id);
    this.cooldowns.removePlayer(id);
    this.skipVotes.delete(id);
  }

  // 클라이언트 입력은 신뢰하지 않는다 — 서버 권위 모델의 경계에서 타입/범위를 강제한다.
  // 필드가 없거나 숫자가 아니면(NaN 포함) 통째로 무시한다 — 한 번이라도 NaN이 x/y에
  // 섞이면 이후 모든 tick에서 계속 NaN으로 오염되기 때문에 여기서 반드시 걸러야 한다.
  setInput(id: string, input: PlayerInputMessage): void {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isFiniteNumber(input.seq) ||
      !isFiniteNumber(input.moveX) ||
      !isFiniteNumber(input.moveY) ||
      !isFiniteNumber(input.aimAngle)
    ) {
      return;
    }

    // 순서가 뒤바뀌었거나 중복된 입력은 버린다. 받아들이면 lastProcessedSeq가 되감기고,
    // 클라이언트가 이미 확정한 구간을 다시 재조정하면서 캐릭터가 튄다.
    const previous = this.inputs.get(id);
    if (previous && input.seq <= previous.seq) return;

    const { moveX, moveY } = normalizeMoveVector(input.moveX, input.moveY);
    this.inputs.set(id, {
      seq: input.seq,
      moveX,
      moveY,
      aimAngle: input.aimAngle,
    });
  }

  /**
   * 퀵슬롯 선택. 잘못된 번호는 조용히 무시한다.
   * 선택만 바꾸는 동작이라 페이즈(낮/밤)와 무관하게 허용한다.
   */
  selectSlot(playerId: string, index: unknown): void {
    this.players.get(playerId)?.inventory.select(index);
  }

  /**
   * 선택 중인 소모품 사용. 효과 적용은 여기서 한다 — 인벤토리는 "무엇이 소모됐는지"만
   * 알려주고, 그게 게임 상태에 어떤 의미인지는 World가 결정한다.
   */
  useSelectedItem(playerId: string): void {
    const player = this.players.get(playerId);
    // 쓰러진 플레이어는 스스로 회복할 수 없다 — 부활은 동료가 해야 한다.
    if (!player || player.hp <= 0) return;

    const selected = player.inventory.itemOfSelected();
    if (!selected) return;

    // 효과가 없는 상황이면 **소모하지 않는다.** 체력이 가득인데 붕대만 날리는 일이
    // 없어야 한다 — 어떤 효과든 "지금 의미가 있는가"를 먼저 묻고 나서 꺼낸다.
    if (selected.healAmount !== undefined && player.hp >= wavesData.playerHp) return;
    if (selected.coreHealAmount !== undefined && this.core.hp >= this.core.maxHp) return;
    if (
      selected.healAmount === undefined &&
      selected.coreHealAmount === undefined &&
      selected.energyAmount === undefined
    ) {
      return; // 소모품이 아니다(무기·재료를 들고 있다)
    }

    const item = player.inventory.consumeSelected();
    if (!item) return;

    if (item.healAmount !== undefined) {
      player.hp = Math.min(wavesData.playerHp, player.hp + item.healAmount);
    }
    if (item.coreHealAmount !== undefined) {
      this.core.hp = Math.min(this.core.maxHp, this.core.hp + item.coreHealAmount);
    }
    if (item.energyAmount !== undefined) {
      this.core.sharedEnergy += item.energyAmount;
    }
  }

  /**
   * 공격 요청 처리.
   *
   * 무기는 **서버가 인벤토리에서 읽는다** — 예전에는 클라이언트가 weaponId를 실어 보냈는데,
   * 그러면 갖고 있지도 않은 무기를 주장할 수 있었다. 클라이언트는 이제 "공격했다"는
   * 사실만 보낸다.
   */
  fireWeapon(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    // fireWeapon()은 tick()과 무관하게 아무 때나(발사 요청이 오는 즉시) 불릴 수 있다.
    // monsterGrid는 moveMonster()를 거칠 때만 점진적으로 갱신되는데, 몬스터 좌표가
    // moveMonster를 거치지 않고 직접 바뀌는 경로(테스트의 직접 대입, 향후 추가될
    // 수 있는 순간이동류 효과 등)가 있으면 그 사이 그리드가 낡을 수 있다 — 발사
    // 판정(근접/총구 간격) 직전에 한 번 다시 채워서 항상 정확한 상태로 쓴다. 몬스터
    // 수만큼(O(M))이라 비싸지 않다.
    this.rebuildMonsterGrid();

    // 무기를 안 들었으면 맨손이다. 붕대 같은 소모품을 들고 있을 때는 좌클릭이
    // "사용"이라 여기까지 오지 않는다(클라이언트가 useSlot으로 보낸다).
    const weaponId = player.inventory.equippedWeaponId ?? BARE_HANDS_WEAPON_ID;
    if (!this.cooldowns.canFire(playerId, weaponId, this.elapsedSeconds)) return;

    this.cooldowns.recordFire(playerId, weaponId, this.elapsedSeconds);
    const result = resolveFire({
      playerId,
      weaponId,
      x: player.x,
      y: player.y,
      aimAngle: player.aimAngle,
    });

    if (result.projectile) {
      // 총구가 플레이어 좌표에서 muzzleOffset만큼 떨어진 곳에서 "순간이동하듯" 생겨난다
      // (연출용 총구 위치 보정, backend/frontend 병합분). 그런데 몬스터가 그 사이
      // 간격(0~muzzleOffset)에 딱 붙어 있으면, 투사체가 몬스터를 지나친 자리에서
      // 시작해 버려서 조준이 정확해도 절대 맞힐 수 없었다(돌진형 몬스터가 근접
      // 사거리까지 파고든 뒤 총으로는 못 잡는 버그로 제보받음). 총구가 "생겨나기 전"
      // 그 간격을 지나가는 순간 몬스터가 있었을지를 먼저 검사해서, 있었으면 투사체를
      // 날리는 대신 그 자리에서 바로 맞힌 것으로 처리한다.
      if (!this.resolveMuzzleGapHit(player, result.projectile)) {
        this.projectiles.set(result.projectile.id, result.projectile);
      }
    }
    if (result.meleeHit) {
      this.applyMeleeHit(result.meleeHit);
      this.applyMeleeHitToResourceNode(player, result.meleeHit, weaponId);
    }
  }

  /**
   * 낮 스킵 투표. 만장일치(접속 중인 전원 동의) 방식이다(docs/backend/11 §4.1) — 협동
   * 게임에서 한 명이 일방적으로 스킵을 강요하지 못하게 한다. day 페이즈가 아니거나
   * 존재하지 않는 플레이어의 투표는 무시한다.
   */
  castSkipVote(playerId: string): void {
    if (this.waveManager.currentPhase !== 'day') return;
    if (!this.players.has(playerId)) return;

    this.skipVotes.add(playerId);
    if (this.players.size > 0 && this.skipVotes.size >= this.players.size) {
      this.waveManager.skipDay();
      this.skipVotes.clear();
    }
  }

  /**
   * 근접 공격 하나가 자원 노드도 때렸는지 검사한다. `fireWeapon`에서 몬스터 판정
   * (`applyMeleeHit`)과 나란히 호출된다 — 몬스터 여러 마리를 한 번에 베는 것과 달리
   * 자원 노드는 **가장 가까운 것 하나만** 맞힌다(군집으로 뭉쳐 있어서 광역으로 여러
   * 노드를 한 스윙에 캐버리면 채집이 무의미해진다).
   *
   * `requiredTool`과 실제 장착 무기가 정확히 일치해야 데미지가 들어간다 — 도끼로는
   * 나무만, 곡괭이로는 돌만 캘 수 있다(자원채집 도구가 도입된 이후 처음으로 실제
   * 강제되는 규칙 — 예전엔 근접 무기 아무거나로도 "채집 요청"이 통과됐다).
   */
  private applyMeleeHitToResourceNode(player: PlayerEntity, hit: MeleeHit, weaponId: string): void {
    let target: ResourceNodeEntity | undefined;
    let targetDistance = Infinity;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const data = resourcesData[node.type];
      // 티어가 올라도 계열은 같다 — 도끼 T1/T2/T3 모두 나무를 캔다.
      // 맨손(harvestsAny)은 종류를 안 가리는 대신 데미지가 매우 낮다.
      const weapon = weaponsData[weaponId];
      if (!weapon?.harvestsAny && data.requiredTool !== weapon?.toolFamily) continue;
      if (!withinMeleeArc(hit, node.x, node.y, data.hitRadius)) continue;
      const distance = Math.hypot(node.x - hit.originX, node.y - hit.originY);
      if (distance >= targetDistance) continue;
      target = node;
      targetDistance = distance;
    }
    if (!target) return;

    const data = resourcesData[target.type];
    target.hp = Math.max(0, target.hp - hit.damage);
    if (target.hp > 0) return;

    target.respawnTimer = data.respawnSeconds;
    // 고갈된 순간 그 자리는 더 이상 아무것도 막지 않는다("다 캐면 지나갈 수 있다",
    // docs/backend/39) — FlowField가 이 칸을 다시 열린 것으로 즉시 반영하게 한다.
    this.rebuildResourceObstacleCells();
    this.recomputeFlowField();

    // 부순 사람 지갑에 바로 꽂지 않고 바닥에 떨군다 — 줍는 행동이 따로 있어야
    // "부수기"와 "회수"가 분리된다. 자원 종류가 늘어도 분기 없이 데이터로 처리된다.
    this.dropItem(data.dropItemId, data.yieldOnDeplete, target.x, target.y);
  }

  /** 바닥에 아이템을 떨군다. 노드 파괴 외에 몬스터 드랍 등으로도 쓸 수 있다. */
  private dropItem(itemId: string, count: number, x: number, y: number): void {
    const id = `drop_${nextDropId++}`;
    this.droppedItems.set(id, { id, itemId, count, x, y });
  }

  /**
   * 근처 드롭을 줍는다(E). 반경 안에서 가장 가까운 것 하나만 줍는다 — 한 번에 바닥을
   * 쓸어담으면 "주우러 다니는" 행동 자체가 사라진다.
   *
   * 인벤토리가 꽉 차면 들어간 만큼만 줄이고 나머지는 바닥에 남긴다. 조용히 증발시키면
   * 플레이어는 자기 자원이 어디 갔는지 알 수 없다.
   */
  pickUpNearestDrop(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;


    let target: DroppedItemEntity | undefined;
    let targetDistance = Infinity;
    for (const drop of this.droppedItems.values()) {
      const distance = Math.hypot(drop.x - player.x, drop.y - player.y);
      if (distance > PICKUP_RADIUS || distance >= targetDistance) continue;
      target = drop;
      targetDistance = distance;
    }
    if (!target) return;

    const leftover = player.inventory.add(target.itemId, target.count);
    if (leftover === target.count) return; // 한 개도 못 넣었다 — 그대로 둔다

    if (leftover > 0) target.count = leftover;
    else this.droppedItems.delete(target.id);
  }

  getDroppedItems(): ReadonlyMap<string, DroppedItemEntity> {
    return this.droppedItems;
  }

  /**
   * 슬롯 사이로 아이템을 옮긴다. 드래그앤드롭이 그대로 이 한 함수로 표현된다.
   *
   * 컨테이너를 문자열로 받는 이유: 인벤토리↔창고, 인벤토리 내부 재배치(퀵슬롯 순서
   * 바꾸기)를 전부 같은 경로로 처리하기 위해서다. 방향마다 함수를 따로 두면 규칙
   * (스택 병합·자리 바꾸기)을 여러 벌 구현하게 된다.
   *
   * 창고가 얽힌 이동은 코어 근처에서만 된다. 인벤토리 내부 재배치는 어디서든 가능하다.
   */
  moveItem(
    playerId: string,
    from: unknown,
    fromIndex: unknown,
    to: unknown,
    toIndex: unknown,
  ): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (!isContainerName(from) || !isContainerName(to)) return;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    if (from === to && fromIndex === toIndex) return;

    const touchesStorage = from === 'storage' || to === 'storage';
    if (touchesStorage && !this.isNearCore(player)) return;

    const source = from === 'storage' ? this.core.storage : player.inventory;
    const target = to === 'storage' ? this.core.storage : player.inventory;

    const taken = source.takeAt(fromIndex as number);
    if (!taken) return;

    // 목적지에서 밀려난 것(자리 바꾸기)이나 다 못 들어간 것(스택 초과)은 원래 자리로
    // 되돌린다. 안 그러면 아이템이 조용히 사라진다.
    const displaced = target.placeAt(toIndex as number, taken);
    if (displaced) source.placeAt(fromIndex as number, displaced);

    // 창고로 들어간 이동이면 티모시가 반응한다(스왑으로 밀려난 아이템이 있어도
    // taken 자체는 목적지에 자리 잡았으므로 "납품"으로 친다).
    if (to === 'storage') this.enqueueCompanionPersonaEvent('coreDeposit', playerId);
  }

  /**
   * 쉬프트 클릭 빠른 이동(docs/backend/44) — 목적지 칸을 사람이 고르지 않고
   * 반대편 컨테이너(인벤토리↔창고)에 자동으로 넣는다. `Inventory.add()`가 이미
   * "같은 아이템에 먼저 쌓고, 남으면 빈 칸을 새로 연다" 규칙으로 목적지를 고르므로
   * (`pickUpNearestDrop()`이 바닥 드롭을 주울 때 쓰는 것과 같은 메서드) 그대로
   * 재사용한다. 목적지가 꽉 차서 일부만 옮겨지면 옮겨진 만큼만 원래 칸에서 빼고
   * (`removeAt`), 하나도 못 옮기면 원래 칸을 그대로 둔다 — `moveItem`의 "다 못
   * 들어가면 되돌린다" 원칙과 같은 결과다.
   */
  quickMoveItem(playerId: string, container: unknown, index: unknown): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (!isContainerName(container)) return;
    if (!Number.isInteger(index)) return;

    // 인벤토리↔창고 중 한쪽은 항상 storage라 창고 근접 검사는 매번 적용된다.
    if (!this.isNearCore(player)) return;

    const source = container === 'storage' ? this.core.storage : player.inventory;
    const target = container === 'storage' ? player.inventory : this.core.storage;

    const slot = source.slotAt(index as number);
    if (!slot) return;

    const leftover = target.add(slot.itemId, slot.count);
    if (leftover === slot.count) return; // 하나도 못 옮겼다 — 원래 칸 그대로 둔다

    source.removeAt(index as number, slot.count - leftover);
    if (target === this.core.storage) this.enqueueCompanionPersonaEvent('coreDeposit', playerId);
  }

  /** 코어 상호작용(창고 열기 등)이 가능한 거리인지. 클라이언트도 같은 판정을 보여준다. */
  isNearCore(player: PlayerEntity): boolean {
    return isWithinCoreInteract(player.x, player.y);
  }

  canInteractWithCore(playerId: string): boolean {
    const player = this.players.get(playerId);
    return player ? this.isNearCore(player) : false;
  }

  /**
   * 코어 업그레이드 요청. `core.tier`번째(0-based) 단계를 팀 공유 에너지로 산다 —
   * 코어 체력(즉시 회복 + 최대치 증가)·건설 가능 반경·제작/스텟증가 해금이 전부
   * 한 번에 적용된다(docs/backend/38). 마지막 단계까지 다 샀거나 에너지가
   * 부족하면 조용히 무시한다.
   */
  upgradeCore(playerId: string): void {
    if (!this.players.has(playerId)) return;

    // tiers는 "다음 티어로 올리는" 목록이라, 티어 1이 0번 항목을 산다.
    const tier = coreUpgradesData.tiers[this.core.tier - coreUpgradesData.startTier];
    if (!tier) return; // 이미 최고 티어
    if (this.core.sharedEnergy < tier.cost) return;

    this.core.sharedEnergy -= tier.cost;
    this.core.tier += 1;
    this.core.maxHp += tier.coreHpBonus;
    this.core.hp += tier.coreHpBonus;
  }

  /**
   * 제작. 재료는 코어 창고에서 나가고 결과물은 **창고로** 들어간다 — 만든 사람이
   * 바로 손에 쥐지 않는 이유는, 인벤토리가 꽉 찼을 때 결과물이 증발하는 경로를
   * 아예 만들지 않기 위해서다. 꺼내 쓰는 건 드래그 한 번이면 된다.
   *
   * 코어 티어가 레시피 요구치에 못 미치거나 재료가 모자라면 조용히 무시한다 —
   * 어느 쪽도 소비가 일어나지 않는다.
   */
  craftItem(playerId: string, recipeId: unknown): void {
    const player = this.players.get(playerId);
    if (!player || !this.isNearCore(player)) return;
    if (typeof recipeId !== 'string') return;

    const recipe = craftingData.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) return;
    if (this.core.tier < recipe.requiresTier) return;

    const storage = this.core.storage;
    // 하나라도 모자라면 아무것도 소비하지 않는다(부분 차감 방지).
    for (const [itemId, count] of Object.entries(recipe.cost)) {
      if (storage.countOf(itemId) < count) return;
    }
    for (const [itemId, count] of Object.entries(recipe.cost)) {
      storage.consume(itemId, count);
    }

    // 창고가 꽉 차 결과물이 못 들어가면 재료만 날아간다 — 미리 자리를 확인한다.
    const leftover = storage.add(recipe.itemId, 1);
    if (leftover > 0) {
      for (const [itemId, count] of Object.entries(recipe.cost)) storage.add(itemId, count);
    }
  }

  /** 코어 티어에서 만들 수 있는 레시피들. 클라이언트가 목록을 그릴 때도 같은 규칙을 쓴다. */
  availableRecipes(): CraftRecipe[] {
    return craftingData.recipes.filter((recipe) => recipe.requiresTier <= this.core.tier);
  }

  /**
   * 창고의 재료를 상점에 판다. 팔 수 있는 것(sellPrice가 있는 것)만 팔리고,
   * 대금은 팀 공용 자금으로 들어간다.
   */
  sellToShop(playerId: string, itemId: unknown, count: unknown): void {
    const player = this.players.get(playerId);
    if (!player || !this.isNearCore(player)) return;
    if (typeof itemId !== 'string' || !Number.isInteger(count)) return;

    const amount = count as number;
    if (amount <= 0) return;

    const price = itemsData[itemId]?.sellPrice;
    if (price === undefined) return; // 팔 수 없는 물건

    if (!this.core.storage.consume(itemId, amount)) return;
    this.core.money += price * amount;
  }

  /** 상점에서 산다. 대금은 팀 자금에서 나가고 물건은 창고로 들어간다. */
  buyFromShop(playerId: string, itemId: unknown): void {
    const player = this.players.get(playerId);
    if (!player || !this.isNearCore(player)) return;
    if (typeof itemId !== 'string') return;
    // 오늘 진열된 것만 살 수 있다. 어제 봤던 id를 그대로 보내도 통하지 않는다.
    if (!this.core.shopStock.includes(itemId)) return;

    const price = itemsData[itemId]?.buyPrice;
    if (price === undefined || this.core.money < price) return;

    // 창고에 자리가 없으면 돈만 나가는 일이 없도록 먼저 넣어보고 판단한다.
    const leftover = this.core.storage.add(itemId, 1);
    if (leftover > 0) return;

    this.core.money -= price;
  }

  /**
   * 오늘의 상점 진열을 새로 뽑는다. 무기와 소모품을 **따로** 뽑아서, 운 나쁜 날에
   * 회복약이 하나도 없는 진열이 나오지 않게 한다.
   */
  private rollShopStock(): void {
    this.core.shopStock = [
      ...this.rollRotation('weapon', shopData.weaponsPerDay),
      ...this.rollRotation('consumable', shopData.consumablesPerDay),
    ];
  }

  /**
   * 후보에서 `count`개를 등급 가중치에 따라 **중복 없이** 뽑는다.
   *
   * **등급을 먼저 뽑고, 그 등급 안에서 하나를 고른다.** 후보 하나하나에 자기 등급의
   * 가중치를 얹어 한 번에 뽑는 방식이 더 간단해 보이지만, 그러면 등급별 후보 수가
   * 확률을 왜곡한다 — 전설 무기가 2종, 에픽이 1종이면 전설이 에픽보다 두 배 자주
   * 나온다(실제로 10%로 맞춘 가중치가 11.8%로 측정됐다). 등급을 먼저 뽑으면 몇 종이
   * 있든 shop.json의 비율이 그대로 등장 확률이 된다.
   *
   * 뽑힌 것은 후보에서 빼고 다음 판을 돌린다. 어떤 등급이 동나면 그 등급은 후보
   * 목록에서 사라지고 나머지 등급끼리 가중치를 다시 나눈다 — 진열 칸이 비는 것보다
   * 낫다. 후보 자체가 모자라면 있는 만큼만 낸다.
   */
  private rollRotation(kind: ItemKind, count: number): string[] {
    const byRarity = new Map<ItemRarity, string[]>();
    for (const [itemId, item] of Object.entries(itemsData)) {
      if (item.kind !== kind || !item.rarity || item.buyPrice === undefined) continue;
      if ((shopData.rarityWeights[item.rarity] ?? 0) <= 0) continue;
      const bucket = byRarity.get(item.rarity);
      if (bucket) bucket.push(itemId);
      else byRarity.set(item.rarity, [itemId]);
    }

    const picked: string[] = [];
    for (let i = 0; i < count && byRarity.size > 0; i += 1) {
      const rarity = this.pickWeighted([...byRarity.keys()]);
      const bucket = byRarity.get(rarity)!;
      const index = Math.min(bucket.length - 1, Math.floor(this.rng() * bucket.length));

      picked.push(bucket[index]!);
      bucket.splice(index, 1);
      if (bucket.length === 0) byRarity.delete(rarity);
    }
    return picked;
  }

  /** 남아 있는 등급 중 하나를 가중치대로 뽑는다. */
  private pickWeighted(rarities: ItemRarity[]): ItemRarity {
    const total = rarities.reduce(
      (sum, rarity) => sum + (shopData.rarityWeights[rarity] ?? 0),
      0,
    );
    let roll = this.rng() * total;
    for (const rarity of rarities) {
      roll -= shopData.rarityWeights[rarity] ?? 0;
      if (roll < 0) return rarity;
    }
    return rarities[rarities.length - 1]!; // rng가 1에 극히 가까울 때의 안전망
  }

  /** 코어 원점 기준 건설 가능 반경(px). 구매한 단계만큼 baseBuildRadius에 누적된다. */
  getBuildRadius(): number {
    let radius = coreUpgradesData.baseBuildRadius;
    for (let i = 0; i < this.core.tier - coreUpgradesData.startTier; i += 1) {
      radius += coreUpgradesData.tiers[i]?.buildRadiusBonus ?? 0;
    }
    return radius;
  }

  /** 현재 단계 이하 어떤 단계에서든 제작이 해금됐으면 true(한 번 해금되면 계속 유지). */
  isCraftingUnlocked(): boolean {
    return coreUpgradesData.tiers
      .slice(0, this.core.tier - coreUpgradesData.startTier)
      .some((tier) => tier.unlocksCrafting);
  }

  /** 플레이어 스텟 증가 시스템 해금 여부. 아직 그걸 실제로 쓸 UI/구매 로직은 없다 — 플래그만. */
  isStatUpgradesUnlocked(): boolean {
    return coreUpgradesData.tiers
      .slice(0, this.core.tier - coreUpgradesData.startTier)
      .some((tier) => tier.unlocksStatUpgrades);
  }

  /**
   * 건축 요청 처리. `buildingType`/`cx`/`cy`는 네트워크 경계를 넘어온 값이라 타입부터
   * 검증한다. 배치 규칙(docs/backend/18 §3.5): 이미 다른 건축물/자원 노드/코어가 있는
   * 셀, 플레이어가 서 있는 셀엔 지을 수 없다. 비용은 코어의 공유 자원 풀에서 차감한다
   * (자원채집 도구 도입에 맞춘 재설계 — 예전엔 요청자 개인 지갑에서만 나갔다).
   */
  placeBuilding(playerId: string, buildingType: unknown, cx: unknown, cy: unknown): void {
    if (typeof buildingType !== 'string' || !isFiniteNumber(cx) || !isFiniteNumber(cy)) return;
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) return;

    const data = buildingsData[buildingType as BuildingType];
    if (!data) return;
    if (cx < 0 || cy < 0 || cx >= MAP_SIZE_TILES || cy >= MAP_SIZE_TILES) return;
    if (!this.buildings.canPlace(cx, cy)) return;

    const { x, y } = cellCenterWorld(cx, cy);
    // 코어 업그레이드로 건설 가능 구역이 늘어난다(docs/backend/38) — 구역 밖은 아직 못 짓는다.
    // 구역은 원이 아니라 **정사각형**(변의 절반 = getBuildRadius)이다. 격자에 짓는
    // 게임에서 원형 경계는 모서리 칸이 애매하게 잘리는데, 정사각형은 칸 단위로
    // 딱 떨어진다.
    if (Math.max(Math.abs(x), Math.abs(y)) > this.getBuildRadius()) return;

    // 코어 발자국과 겹치는 셀은 전부 금지다 — 스프라이트에 파묻히는 벽이 지어지면 안 된다.
    if (coreDistance(x, y) <= TILE_SIZE / 2) return;

    for (const node of this.resourceNodes.values()) {
      const nodeCell = worldToCell(node.x, node.y);
      if (nodeCell.cx === cx && nodeCell.cy === cy) return;
    }

    for (const other of this.players.values()) {
      const otherCell = worldToCell(other.x, other.y);
      if (otherCell.cx === cx && otherCell.cy === cy) return;
    }

    if (!this.players.has(playerId)) return;

    // 비용은 코어 창고에서 나간다. 둘 중 하나라도 모자라면 아무것도 소비하지 않는다 —
    // 나무만 깎이고 실패하면 자원이 조용히 증발한다.
    const storage = this.core.storage;
    if (storage.countOf('wood') < data.woodCost) return;
    if (storage.countOf('stone') < data.stoneCost) return;

    storage.consume('wood', data.woodCost);
    storage.consume('stone', data.stoneCost);

    const id = `building_${nextBuildingId++}`;
    this.buildings.place(id, buildingType as BuildingType, cx, cy, x, y);
    this.recomputeFlowField();
  }

  /**
   * 철거 요청 처리(건설모드의 'demolish', docs/backend/43). 자원 환급은 없다 —
   * 재배치/실수 정리용이지 자원 순환 수단이 아니다. 코어 건설 반경 검사는 안
   * 한다 — 이미 지어진 건축물은 그 시점에 이미 반경 안이었고, 반경은 코어
   * 티어가 오를수록만 넓어지므로(줄어들지 않으므로) 항상 유효하다.
   */
  demolishBuilding(playerId: string, cx: unknown, cy: unknown): void {
    if (!isFiniteNumber(cx) || !isFiniteNumber(cy)) return;
    if (!Number.isInteger(cx) || !Number.isInteger(cy)) return;
    if (!this.players.has(playerId)) return;

    const building = this.buildings.at(cx, cy);
    if (!building) return;

    this.buildings.remove(building.id);
    this.recomputeFlowField();
  }

  /**
   * 테스트용: 특정 웨이브(1-based)로 즉시 이동한다(docs/backend/23). 이전 웨이브의
   * 몬스터가 필드에 남아 있으면 새 웨이브 몬스터와 섞여 테스트 결과가 헷갈리니
   * 함께 정리한다 — 코어/플레이어 HP는 건드리지 않는다(그건 테스트하려는 대상일 수
   * 있으니). 웨이브 번호가 범위를 벗어나 실제로 이동하지 않았으면 몬스터도 그대로
   * 둔다.
   */
  debugJumpToWave(waveNumber: number): void {
    if (this.waveManager.debugJumpToWave(waveNumber)) {
      this.monsters.clear();
      this.monsterGrid.clear();
    }
  }

  /**
   * 살아 있는 플레이어 주변을 밝힌다. **칸이 바뀐 사람만** 계산한다 — 제자리에 선
   * 동안 같은 원을 매 틱 다시 칠할 이유가 없다.
   */
  private revealAroundPlayers(): void {
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;

      const { cx, cy } = worldToCell(player.x, player.y);
      const cell = cy * MAP_SIZE_TILES + cx;
      if (this.lastRevealCell.get(player.id) === cell) continue;

      this.lastRevealCell.set(player.id, cell);
      this.explored.revealAround(player.x, player.y);
    }
  }

  /**
   * 팀이 밝힌 지역의 비트맵(칸당 1비트, 2KB). 서버는 이걸 스키마에 복사해 내려보내고
   * 로컬 모드는 그대로 읽는다 — 복사본이 아니라 내부 버퍼다(읽기 전용으로 쓸 것).
   */
  getExplored(): Uint8Array {
    return this.explored.raw;
  }

  /**
   * 새 낮이 시작될 때 한 번 일어나는 일들. 정상 진행(웨이브 클리어)과 개발 커맨드가
   * **같은 함수**를 쓴다 — 둘이 갈라지면 "커맨드로 넘긴 낮"에서만 상점이 안 바뀌는
   * 식의 차이가 생긴다.
   */
  private onDayBegan(): void {
    this.revivePlayers();
    this.reviveCompanion();
    this.skipVotes.clear();
    // 하루가 지나면 상점 물건이 통째로 바뀐다. 오늘 못 산 전설은 오늘로 끝이다.
    this.rollShopStock();
    // 정화된 콜로니는 재보급, 살아남은 콜로니는 성장(§settleColoniesOnDayBegan).
    this.settleColoniesOnDayBegan();
  }

  /**
   * 사람과 같은 타이밍에 티모시도 회복시킨다 — 새 부활 상호작용을 만들지 않고
   * 기존 "낮 시작 시 전원 풀피" 훅에 얹는다(docs/superpowers/specs/
   * 2026-08-07-ai-companion-timothy-design.md). 다운 중이 아니었으면(hp 이미 가득)
   * 아무 효과 없다.
   */
  private reviveCompanion(): void {
    const wasDowned = this.companion.state === 'downed';
    this.companion.hp = this.companion.maxHp;
    if (!wasDowned) return;
    this.companion.state = 'seeking';
    const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
    if (nearestId) this.enqueueCompanionPersonaEvent('companionRevived', nearestId);
  }

  /**
   * 개발자 커맨드 한 줄을 실행한다(devCommands.ts).
   *
   * **켜고 끄는 판단은 여기서 하지 않는다** — 호출하는 쪽(로컬 모드, 또는 개발
   * 플래그가 켜진 서버)이 판단해서 부른다. World가 스스로 "개발 모드인가"를 들고
   * 있으면 그 플래그가 시뮬레이션 규칙 곳곳으로 새기 쉽다.
   */
  runDevCommand(playerId: string, line: string): DevCommandResult {
    return runDevCommand(this.devAccess(), playerId, line);
  }

  /**
   * 개발 커맨드가 월드를 건드릴 수 있는 통로. private 필드를 커맨드 모듈에 통째로
   * 열어주는 대신, 필요한 동작만 골라 함수로 넘긴다.
   */
  private devAccess(): DevWorldAccess {
    return {
      hasPlayer: (playerId) => this.players.has(playerId),

      giveToInventory: (playerId, itemId, count) =>
        this.players.get(playerId)?.inventory.add(itemId, count) ?? count,
      giveToStorage: (itemId, count) => this.core.storage.add(itemId, count),
      dropAtPlayer: (playerId, itemId, count) => {
        const player = this.players.get(playerId);
        if (player) this.dropItem(itemId, count, player.x, player.y);
      },
      clearInventory: (playerId) => {
        const inventory = this.players.get(playerId)?.inventory;
        if (!inventory) return;
        for (let index = 0; index < inventory.toView().slots.length; index += 1) {
          inventory.takeAt(index);
        }
      },
      clearStorage: () => {
        for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) this.core.storage.takeAt(index);
      },

      setMoney: (amount) => {
        this.core.money = amount;
      },
      setEnergy: (amount) => {
        this.core.sharedEnergy = amount;
      },
      setTier: (tier) => {
        const maxTier = coreUpgradesData.startTier + coreUpgradesData.tiers.length;
        this.core.tier = Math.max(coreUpgradesData.startTier, Math.min(maxTier, tier));
        return this.core.tier;
      },

      jumpToWave: (waveNumber) => {
        const moved = this.waveManager.debugJumpToWave(waveNumber);
        if (moved) this.clearAllMonsters();
        return moved;
      },
      forceDay: () => {
        this.clearAllMonsters();
        // 스폰 큐까지 비워야 낮에 몬스터가 계속 튀어나오지 않는다. 낮에 딸린 일은
        // 정상 진행과 같은 함수로 처리한다.
        if (this.waveManager.debugEndNight() && this.waveManager.currentPhase === 'day') {
          this.onDayBegan();
          this.enqueuePersonaEvent('waveEnd');
          this.enqueueCompanionWaveEndEvent();
        }
      },
      spawnMonsters: (type, count) => {
        for (let i = 0; i < count; i += 1) {
          // 코어 주변 원형으로 흩뿌린다. 한 점에 겹쳐 놓으면 분리 로직이 튄다.
          const angle = (i / count) * Math.PI * 2;
          const radius = DEV_SPAWN_RADIUS + (i % 3) * TILE_SIZE;
          this.addMonster(type, Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
      },
      clearMonsters: () => this.clearAllMonsters(),

      healPlayer: (playerId) => {
        const player = this.players.get(playerId);
        if (player) player.hp = wavesData.playerHp;
      },
      setCoreHp: (amount) => {
        this.core.hp = Math.min(this.core.maxHp, amount);
      },
      rerollShop: () => this.rollShopStock(),
      forceCoreVoice: () => this.enqueuePersonaEvent('coreInteract'),
    };
  }

  tick(dtSeconds: number): void {
    this.elapsedSeconds += dtSeconds;

    // 이번 틱의 피격 여부를 새로 센다 — damagePlayer()가 이번 틱 중 세팅하고,
    // tickChannels()가 tickMonsters() 이후(=피격이 이미 반영된 뒤)에 읽는다.
    for (const player of this.players.values()) player.tookDamageThisTick = false;

    for (const [id, player] of this.players) {
      const input = this.inputs.get(id);
      if (!input) continue;
      this.movePlayer(player, input.moveX, input.moveY, dtSeconds);
      player.aimAngle = input.aimAngle;
      player.lastProcessedSeq = input.seq;
    }

    const previousPhase = this.waveManager.currentPhase;
    this.waveManager.tick(
      dtSeconds,
      // 아직 스폰 대기 중인 콜로니 침공 복제분도 "살아있는" 것으로 계산해야 한다 —
      // 본대가 먼저 전멸해도 복제분이 다 나올 때까지 밤이(보스가) 오지 않게.
      () => this.monsters.size + this.pendingContingentCount(),
      (type, x, y) => this.addMonster(type, x, y),
    );
    // 밤이 끝나고 새 낮이 시작되는 시점(웨이브 클리어) — 다운된 플레이어를 부활시키고
    // 지난 낮의 스킵 투표를 초기화한다(docs/backend/11 §4.1).
    if (previousPhase !== 'day' && this.waveManager.currentPhase === 'day') {
      this.onDayBegan();
    }
    // 낮이 끝나고 밤이 시작되는 시점 — 콜로니 저장분이 복제되어 침공에 합류한다.
    if (previousPhase === 'day' && this.waveManager.currentPhase === 'night') {
      this.buildNightContingents();
    }
    // 밤이 끝난 시점(다음 낮이든 최종 승리든) — 코어 AI 페르소나가 그 웨이브를 코멘트한다.
    if (
      previousPhase === 'night' &&
      (this.waveManager.currentPhase === 'day' || this.waveManager.currentPhase === 'victory')
    ) {
      this.enqueuePersonaEvent('waveEnd');
      this.enqueueCompanionWaveEndEvent();
    }

    this.revealAroundPlayers();

    this.tickMonsters(dtSeconds);
    // tickMonsters() 다음에 불러야 몬스터들의 이번 틱 위치 기준으로 근접 판정한다.
    this.tickCompanionDamage(dtSeconds);
    this.tickCompanion(dtSeconds);
    this.tickQueuedCompanionMessages();
    this.tickResourceNodes(dtSeconds);
    // tickMonsters() 다음에 불러야 한다 — 이번 틱에 죽은 수호대가 guardIds에서
    // 이미 빠진 뒤여야 정화 판정이 한 틱 늦지 않는다.
    this.tickColonyGuards(dtSeconds);
    this.tickContingents(dtSeconds);

    tickProjectiles(this.projectiles, dtSeconds);
    this.resolveProjectileHits();

    if (this.core.hp <= 0) this.waveManager.markDefeat();
    this.checkAllPlayersDown();
  }

  getPlayers(): ReadonlyMap<string, PlayerEntity> {
    return this.players;
  }

  getMonsters(): ReadonlyMap<string, MonsterEntity> {
    return this.monsters;
  }

  getProjectiles(): ReadonlyMap<string, ProjectileEntity> {
    return this.projectiles;
  }

  getCore(): Readonly<CoreState> {
    return this.core;
  }

  getBuildings(): ReadonlyMap<string, BuildingEntity> {
    return this.buildings.entries();
  }

  getResourceNodes(): ReadonlyMap<string, ResourceNodeEntity> {
    return this.resourceNodes;
  }

  getColonies(): ReadonlyMap<string, ColonyEntity> {
    return this.colonies.entries();
  }

  getCompanion(): Readonly<CompanionEntity> {
    return this.companion;
  }

  getWavePhase(): GamePhase {
    return this.waveManager.currentPhase;
  }

  /** 현재 페이즈가 끝나기까지 남은 시간(초). HUD의 웨이브 다이얼이 쓴다. */
  getPhaseTimeRemaining(): number {
    return this.waveManager.phaseTimeRemaining;
  }

  getCurrentWave(): number {
    return this.waveManager.currentWave;
  }

  /** 현재 낮 스킵 투표에 동의한 인원 수. 필요 인원은 접속 중인 전원(getPlayers().size)이다. */
  getSkipVoteCount(): number {
    return this.skipVotes.size;
  }

  /** 트레잇을 갱신하고 큐에 이벤트를 적재한다. LLM 호출은 GameRoom 몫이라 여기선 하지 않는다. */
  private enqueuePersonaEvent(kind: PersonaEvent['kind']): void {
    this.personaTraits = applyPersonaEvent(this.personaTraits, kind, corePersonaData.eventWeights, {
      min: corePersonaData.traitMin,
      max: corePersonaData.traitMax,
    });
    this.pendingPersonaEvents.push({
      kind,
      traits: this.personaTraits,
      wave: this.waveManager.currentWave,
    });
  }

  /**
   * 코어 모달을 연 플레이어의 상호작용 요청. 쿨다운(corePersonaData.coreInteractionCooldownSeconds)
   * 안이면 조용히 무시한다 — 연타로 대사가 도배되는 걸 막는다(룸 전역 쿨다운, 플레이어별 아님).
   * 성공하면 true.
   */
  requestCoreInteraction(): boolean {
    const cooldown = corePersonaData.coreInteractionCooldownSeconds;
    if (this.elapsedSeconds - this.lastCoreInteractionAt < cooldown) return false;
    this.lastCoreInteractionAt = this.elapsedSeconds;
    this.enqueuePersonaEvent('coreInteract');
    return true;
  }

  /** 쌓인 페르소나 이벤트를 전부 꺼내고 큐를 비운다. GameRoom이 매 틱 폴링한다. */
  drainPersonaEvents(): PersonaEvent[] {
    if (this.pendingPersonaEvents.length === 0) return [];
    const events = this.pendingPersonaEvents;
    this.pendingPersonaEvents = [];
    return events;
  }

  private companionTraitFor(playerId: string): CorePersonaTraits {
    let traits = this.companionTraits.get(playerId);
    if (!traits) {
      traits = createInitialCompanionTraits();
      this.companionTraits.set(playerId, traits);
    }
    return traits;
  }

  /**
   * 트레잇은 이벤트마다 항상 갱신한다(대사 쿨다운과 무관하게 관계는 계속 쌓인다).
   * 실제 대사(LLM 호출/브로드캐스트) 큐는 방 전역 쿨다운을 통과했을 때만 채운다 —
   * 그러지 않으면 코어 납품처럼 짧은 시간에 여러 번 일어나는 이벤트가 대사를 도배한다.
   */
  private enqueueCompanionPersonaEvent(kind: CompanionPersonaEventKind, playerId: string): void {
    const traits = applyCompanionPersonaEvent(this.companionTraitFor(playerId), kind);
    this.companionTraits.set(playerId, traits);

    const cooldown = companionData.persona.interactionCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionCommentaryAt < cooldown) return;
    this.lastCompanionCommentaryAt = this.elapsedSeconds;

    this.pendingCompanionPersonaEvents.push({
      kind,
      playerId,
      traits,
      wave: this.waveManager.currentWave,
    });
  }

  /**
   * 웨이브 종료는 방 전체 이벤트라 특정 행위자가 없다 — 그 순간 티모시와 가장 가까운
   * 플레이어를 향해 말한다. 정상 진행(tick)과 개발 커맨드(day)가 같은 함수를 쓴다.
   */
  private enqueueCompanionWaveEndEvent(): void {
    const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
    if (nearestId) this.enqueueCompanionPersonaEvent('waveEnd', nearestId);
  }

  /** 특정 지점에서 가장 가까운, 다운되지 않은 플레이어 id. 후보가 없으면 undefined. */
  private findNearestPlayerId(x: number, y: number): string | undefined {
    let nearestId: string | undefined;
    let nearestDistance = Infinity;
    for (const [id, player] of this.players) {
      if (player.hp <= 0) continue;
      const distance = Math.hypot(player.x - x, player.y - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = id;
      }
    }
    return nearestId;
  }

  /** 티모시 옆에서 상호작용(E)했음을 알린다. 사거리 밖이면 조용히 무시하고 false. */
  requestCompanionInteraction(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    const distance = Math.hypot(player.x - this.companion.x, player.y - this.companion.y);
    if (distance > companionData.interactRange) return false;
    this.enqueueCompanionPersonaEvent('proximityInteract', playerId);
    return true;
  }

  /**
   * 채팅으로 "@티모시 ..." 하고 직접 말을 걸었을 때. 거리 제한이 없다(채팅 자체가 방
   * 전체에 항상 보이는 것과 같은 맥락) — 대신 `enqueueCompanionPersonaEvent`의 방 전역
   * 잡담 쿨다운과는 별개인 자체 쿨다운만 통과해야 한다. 쿨다운 중이면 버리지 않고
   * 큐에 쌓아뒀다가 tick()에서 쿨다운이 끝나는 대로 순서대로 하나씩 내보낸다(연달아
   * 두 번 물어보면 두 번째가 조용히 씹히던 문제를 이렇게 고쳤다) — 대신 큐가
   * MAX_QUEUED_COMPANION_MESSAGES를 넘기면 그건 진짜 스팸으로 보고 거절한다.
   */
  sendCompanionMessage(playerId: string, message: string): boolean {
    if (!this.players.has(playerId)) return false;
    const cooldown = companionData.persona.playerMessageCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionMessageAt < cooldown) {
      if (this.queuedCompanionMessages.length >= World.MAX_QUEUED_COMPANION_MESSAGES) return false;
      this.queuedCompanionMessages.push({ playerId, message });
      return true;
    }
    this.emitCompanionMessage(playerId, message);
    return true;
  }

  /** sendCompanionMessage의 실제 처리부 — 쿨다운을 이미 통과했다고 가정한다. */
  private emitCompanionMessage(playerId: string, message: string): void {
    this.lastCompanionMessageAt = this.elapsedSeconds;
    const traits = applyCompanionPersonaEvent(this.companionTraitFor(playerId), 'playerMessage');
    this.companionTraits.set(playerId, traits);
    // 지금까지의 대화 기록(이번 메시지 이전까지)을 이벤트에 실어 보낸다 — 이번 메시지
    // 자체는 buildCompanionPersonaPrompt가 새 user 턴으로 따로 붙인다. 복사본을 넘겨야
    // 한다 — 안 그러면 바로 아래 pushCompanionHistory가 같은 배열 객체를 이어서 밀어
    // 넣어서, 이 이벤트에 실린 "이전까지의 기록"에 방금 보낸 메시지까지 같이 보이게 된다.
    const history = [...this.getCompanionHistory(playerId)];
    this.pendingCompanionPersonaEvents.push({
      kind: 'playerMessage',
      playerId,
      traits,
      wave: this.waveManager.currentWave,
      message,
      history,
    });
    this.pushCompanionHistory(playerId, 'user', message);
  }

  /** 쿨다운이 끝났고 큐에 대기 중인 질문이 있으면 가장 오래된 것 하나를 내보낸다. tick()이 매 틱 부른다. */
  private tickQueuedCompanionMessages(): void {
    if (this.queuedCompanionMessages.length === 0) return;
    const cooldown = companionData.persona.playerMessageCooldownSeconds;
    if (this.elapsedSeconds - this.lastCompanionMessageAt < cooldown) return;
    const next = this.queuedCompanionMessages.shift()!;
    this.emitCompanionMessage(next.playerId, next.message);
  }

  /** "@티모시 ..." 대화 기록(이 플레이어와 나눈 최근 대화). GameRoom이 프롬프트에 이어 붙인다. */
  getCompanionHistory(playerId: string): readonly CompanionPersonaTurn[] {
    return this.companionConversations.get(playerId) ?? [];
  }

  /** LLM이 실제로 뭐라고 답했는지 기록한다 — GameRoom이 응답을 받은 뒤 호출한다. */
  recordCompanionReply(playerId: string, reply: string): void {
    this.pushCompanionHistory(playerId, 'assistant', reply);
  }

  private pushCompanionHistory(playerId: string, role: CompanionPersonaTurn['role'], content: string): void {
    const history = this.companionConversations.get(playerId) ?? [];
    history.push({ role, content });
    const limit = companionData.persona.historyMessageLimit;
    while (history.length > limit) history.shift();
    this.companionConversations.set(playerId, history);
  }

  /** 쌓인 티모시 대사 이벤트를 전부 꺼내고 큐를 비운다. GameRoom이 매 틱 폴링한다. */
  drainCompanionPersonaEvents(): CompanionPersonaEvent[] {
    if (this.pendingCompanionPersonaEvents.length === 0) return [];
    const events = this.pendingCompanionPersonaEvents;
    this.pendingCompanionPersonaEvents = [];
    return events;
  }

  /** 코어 셀로 Flow Field를 다시 계산한다. 생성자, 건축물 설치/파괴 시에만 호출한다(매 틱 금지). */
  private recomputeFlowField(): void {
    const coreCell = worldToCell(0, 0);
    this.flowField.recompute(coreCell.cx, coreCell.cy);
  }

  /** 자원 노드를 코어 주변에 군집(클러스터)으로 배치한다. 클래스 상단 상수 주석 참고. */
  private seedResourceNodes(): void {
    this.seedResourceClusters('wood', WOOD_CLUSTER_COUNT, WOOD_NODES_PER_CLUSTER);
    this.seedResourceClusters('stone', STONE_CLUSTER_COUNT, STONE_NODES_PER_CLUSTER);
  }

  private seedResourceClusters(type: ResourceType, clusterCount: number, nodesPerCluster: number): void {
    const data = resourcesData[type];

    for (let i = 0; i < clusterCount; i += 1) {
      const clusterAngle = this.rng() * Math.PI * 2;
      const clusterDistance =
        CLUSTER_MIN_DISTANCE + this.rng() * (CLUSTER_MAX_DISTANCE - CLUSTER_MIN_DISTANCE);
      const clusterX = Math.cos(clusterAngle) * clusterDistance;
      const clusterY = Math.sin(clusterAngle) * clusterDistance;

      const placed: { x: number; y: number }[] = [];
      for (let n = 0; n < nodesPerCluster; n += 1) {
        const position = this.pickClusterNodePosition(clusterX, clusterY, placed, data.hitRadius);
        placed.push(position);

        const id = `resource_${nextResourceNodeId++}`;
        this.resourceNodes.set(id, {
          id,
          type,
          x: position.x,
          y: position.y,
          hp: data.hp,
          maxHp: data.hp,
          respawnTimer: 0,
          clusterX,
          clusterY,
        });
        // 셀 등록은 여기서 하지 않는다 — 생성자가 시딩이 다 끝난 뒤
        // rebuildResourceObstacleCells()를 한 번만 불러 한꺼번에 계산한다.
      }
    }
  }

  /**
   * 클러스터 중심 주변 `CLUSTER_JITTER_RADIUS` 안에서 무작위 위치를 고른다. 이미 놓인
   * 것(같은 군집의 다른 노드)과 `MIN_NODE_SPACING`보다 가깝거나, 지금 서 있는
   * 플레이어와 겹치면 다시 뽑는다 — 몇 번 재시도해도 계속 안 되면(좁은 지터 반경
   * 안에 노드가 너무 많거나 플레이어가 하필 그 자리에 서 있는 극단적인 경우)
   * 완벽한 조건보다 무한 재시도 방지가 우선이라 마지막으로 뽑은 위치를 그냥 쓴다.
   *
   * 최초 시딩(World 생성자)과 리스폰 재배치(§relocateRespawnedNode) 둘 다 이
   * 메서드를 쓴다 — 생성자 시점엔 아직 플레이어가 한 명도 없어서(addPlayer()는
   * 항상 그 이후에 불린다) 플레이어 충돌 검사가 자동으로 아무 효과가 없다.
   */
  private pickClusterNodePosition(
    centerX: number,
    centerY: number,
    placed: { x: number; y: number }[],
    nodeRadius: number,
  ): { x: number; y: number } {
    const MAX_ATTEMPTS = 8;
    let candidate = { x: centerX, y: centerY };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = this.rng() * CLUSTER_JITTER_RADIUS;
      candidate = { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };

      const tooCloseToSibling = placed.some(
        (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < MIN_NODE_SPACING,
      );
      const overlapsPlayer = [...this.players.values()].some((player) =>
        circlesOverlap(player.x, player.y, candidate.x, candidate.y, HIT_RADIUS + nodeRadius),
      );
      if (!tooCloseToSibling && !overlapsPlayer) return candidate;
    }

    return candidate;
  }

  /**
   * 고갈됐다가 리스폰하는 노드를 같은 군집 안 새 무작위 위치로 옮긴다(docs/backend/39)
   * — 항상 같은 자리에 다시 나던 걸 바꿔서, 자주 캐는 자리 하나가 사실상 영구
   * 장애물처럼 남지 않게 한다. `pickClusterNodePosition`을 그대로 재사용하되
   * "이미 놓인 것"으로 같은 군집의 **살아있는** 형제 노드만 넘긴다(다른 군집이나
   * 고갈된 노드는 겹쳐도 상관없다).
   */
  private relocateRespawnedNode(node: ResourceNodeEntity): void {
    const data = resourcesData[node.type];
    const siblings: { x: number; y: number }[] = [];
    for (const other of this.resourceNodes.values()) {
      if (other === node || other.hp <= 0) continue;
      if (other.clusterX !== node.clusterX || other.clusterY !== node.clusterY) continue;
      siblings.push({ x: other.x, y: other.y });
    }

    const position = this.pickClusterNodePosition(node.clusterX, node.clusterY, siblings, data.hitRadius);
    node.x = position.x;
    node.y = position.y;
  }

  /** 몬스터를 추가하고 id를 돌려준다 — 수호대 소환처럼 스폰 직후 추가 설정이 필요한 곳용. */
  private addMonster(type: MonsterType, x: number, y: number): string {
    const data = monstersData[type];
    const id = `monster_${nextMonsterId++}`;
    // 스폰 직후엔 코어를 향해 걷기 시작하니, 초기 시야 방향도 코어 쪽으로 잡아둔다.
    const distanceToCore = Math.hypot(x, y);
    const facingX = distanceToCore > 0 ? -x / distanceToCore : 0;
    const facingY = distanceToCore > 0 ? -y / distanceToCore : -1;
    this.monsters.set(id, {
      id,
      type,
      x,
      y,
      hp: data.hp,
      maxHp: data.hp,
      attackCooldown: 0,
      facingX,
      facingY,
      pattern: { kind: 'idle' },
      specialAttackCooldown:
        data.chargeAttack || data.slamAttack || data.meleeAttacks ? BOSS_FIRST_PATTERN_DELAY : 0,
      stuckSeconds: 0,
      companionAttackCooldown: 0,
      guardReturnTimer: 0,
      attackAnimTimer: 0,
      attackAnim: 0,
      meleeCooldowns: (data.meleeAttacks ?? []).map(() => 0),
    });
    this.monsterGrid.insert(id, x, y);
    return id;
  }

  /**
   * 다운된(hp 0) 플레이어는 이미 전투 불능이라 몬스터의 추격/공격 대상에서 제외한다.
   * 시야각(§AGGRO_FOV_COS_HALF_ANGLE) 밖의 플레이어도 후보에서 제외한다 — 몬스터의
   * `facingX/Y`와 플레이어 방향 단위 벡터의 내적으로 판정한다(플레이어가 몬스터와
   * 정확히 같은 좌표면 방향을 정의할 수 없으니 그 경우만 시야각 검사를 건너뛴다).
   */
  private findNearestPlayer(monster: MonsterEntity, radius: number): PlayerEntity | undefined {
    let nearest: PlayerEntity | undefined;
    let nearestDistance = radius;

    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      const dx = player.x - monster.x;
      const dy = player.y - monster.y;
      const distance = Math.hypot(dx, dy);
      if (distance > nearestDistance) continue;

      if (distance > 0) {
        const facingDot = (dx / distance) * monster.facingX + (dy / distance) * monster.facingY;
        if (facingDot < AGGRO_FOV_COS_HALF_ANGLE) continue;
      }

      nearest = player;
      nearestDistance = distance;
    }

    return nearest;
  }

  /**
   * 플레이어에게 데미지를 적용하는 유일한 경로. hp를 깎는 것뿐 아니라
   * `tookDamageThisTick`도 같이 세팅한다 — 콜로니 채널링의 "피격 시 중단"
   * 판정(tickChannels)이 이 플래그를 읽는다. 몬스터가 플레이어를 때리는 모든
   * 경로(추격 공격, 보스 돌진/광역)가 반드시 이 메서드를 거쳐야 한다.
   */
  private damagePlayer(player: PlayerEntity, amount: number): void {
    player.hp = Math.max(0, player.hp - amount);
    player.tookDamageThisTick = true;
  }

  /** 웨이브를 클리어하고 새 낮이 시작될 때 다운된 플레이어를 전원 부활시킨다. */
  private revivePlayers(): void {
    for (const player of this.players.values()) {
      player.hp = wavesData.playerHp;
    }
  }

  /**
   * 접속 중인 플레이어 전원이 다운(hp 0) 상태면 즉시 패배 처리한다(docs/backend/11 §4.1).
   * 플레이어가 아무도 없으면(전원 퇴장) 패배 조건이 아니다.
   */
  private checkAllPlayersDown(): void {
    if (this.players.size === 0) return;
    const allDown = [...this.players.values()].every((player) => player.hp <= 0);
    if (allDown) this.waveManager.markDefeat();
  }

  /** 고갈된 자원 노드의 리스폰 타이머를 감소시키고, 다 되면 채집 가능 상태로 되돌린다. */
  /**
   * 고갈된 자원 노드의 리스폰 타이머를 감소시키고, 다 되면 채집 가능 상태로 되돌린다
   * — 이때 같은 자리가 아니라 같은 군집 안 새 위치로 옮긴다(§relocateRespawnedNode,
   * docs/backend/39). 한 틱에 여러 노드가 동시에 리스폰될 수 있어서, 장애물 셀
   * 재계산은 노드마다 하지 않고 루프가 끝난 뒤 한 번만 한다.
   */
  private tickResourceNodes(dtSeconds: number): void {
    let anyRespawned = false;

    for (const node of this.resourceNodes.values()) {
      if (node.respawnTimer <= 0) continue;
      node.respawnTimer -= dtSeconds;
      if (node.respawnTimer <= 0) {
        node.hp = resourcesData[node.type].hp;
        node.respawnTimer = 0;
        this.relocateRespawnedNode(node);
        anyRespawned = true;
      }
    }

    if (anyRespawned) {
      this.rebuildResourceObstacleCells();
      this.recomputeFlowField();
    }
  }

  /**
   * 콜로니 수호대 소환/정화 판정. `tickMonsters()` 이후에 불러야 한다 — 이번 틱에
   * 죽은 수호대가 guardIds에서 이미 빠진 뒤여야 정화가 한 틱 늦지 않는다.
   *
   * 소환 규칙: 살아있는 플레이어가 트리거 반경 안에 있으면 저장분에서 한 마리씩
   * 꺼내 소환하고, 동시 수호대 수(guardConcurrent)를 유지하도록 보충한다. 저장분
   * 전체가 한꺼번에 쏟아지지 않게 하는 건 압박 유지와 "입구 낚시" 방지를 겸한다 —
   * 대신 순차 보충이라 플레이어가 하나씩 끊어 먹는 것도 자연히 가능하다(설계 의도).
   *
   * 페이즈(낮/밤) 무관하게 돈다 — 밤에도 콜로니에 접근하면 수호대가 나온다.
   */
  private tickColonyGuards(dtSeconds: number): void {
    for (const colony of this.colonies.values()) {
      if (colony.purified) continue;

      // 정화: 저장분도 수호대도 남지 않은 순간, 이 콜로니는 비워졌다.
      if (colony.stored <= 0 && colony.guardIds.size === 0) {
        this.purifyColony(colony);
        continue;
      }

      const triggered = this.anyAlivePlayerWithin(colony.x, colony.y, coloniesData.triggerRadius);
      if (!triggered) {
        // 아무도 없으면 보충 타이머를 초기값으로 되돌린다 — 다음 접근 때 곧바로
        // 첫 수호대가 나오게(경계에서 들락거리며 타이머만 갉는 것 방지).
        colony.guardRespawnTimer = 0;
        continue;
      }

      if (colony.stored <= 0 || colony.guardIds.size >= coloniesData.guardConcurrent) continue;

      colony.guardRespawnTimer -= dtSeconds;
      if (colony.guardRespawnTimer > 0) continue;
      colony.guardRespawnTimer = coloniesData.guardRespawnSeconds;

      const stage = colonyStageData(colony.stage);
      const type = stage.types[Math.floor(this.rng() * stage.types.length)] as MonsterType;

      // 콜로니 중심 좌표 그대로 스폰시키면 콜로니 자신의 하드 충돌 반경(docs/backend/38)
      // 안에서 태어나 영구히 끼어버린다(docs/backend/40). 경계 바로 바깥에 스폰한다.
      const spawnMonsterR = monstersData[type]?.hitRadius ?? HIT_RADIUS;
      const angle = this.rng() * Math.PI * 2;
      const offset = COLONY_RADIUS + spawnMonsterR + 2; // 여유 2px — 겹침 없이 확실히 밖
      const guardId = this.addMonster(
        type,
        colony.x + Math.cos(angle) * offset,
        colony.y + Math.sin(angle) * offset,
      );
      const guard = this.monsters.get(guardId);
      if (guard) {
        guard.homeColonyId = colony.id;
        colony.stored -= 1;
        colony.guardIds.add(guardId);
      }
    }
  }

  /**
   * 수호대 한 마리의 틱. 일반 몬스터와 달리 **콜로니 중심** 기준으로 판단한다 —
   * 자기 위치 기준이면 추격 중에 리시가 몬스터를 따라 이동해 무한 추격이 된다.
   *
   * 1) 리시 반경(콜로니 기준) 안에 살아있는 플레이어가 있으면 가장 가까운 쪽을 요격.
   * 2) 없으면 콜로니 곁으로 귀환. 도착 후 returnDespawnSeconds가 지나면 저장 상태로
   *    복귀한다 — 엔티티가 사라지고 콜로니 stored가 복원된다("자연스럽게 돌아가
   *    수호하다가 저장 상태로").
   */
  private tickGuard(monster: MonsterEntity, data: MonsterData, dtSeconds: number): void {
    const colony = this.colonies.get(monster.homeColonyId!);
    if (!colony) {
      // 방어적 처리 — 소속 콜로니가 없으면(있을 수 없는 상태) 일반 몬스터로 강등한다.
      monster.homeColonyId = undefined;
      return;
    }

    // 요격 대상: 리시 반경(콜로니 기준) 안에서 수호대 자신과 가장 가까운 생존자.
    let target: PlayerEntity | undefined;
    let bestDistance = Infinity;
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (Math.hypot(player.x - colony.x, player.y - colony.y) > coloniesData.leashRadius) continue;
      const distance = Math.hypot(player.x - monster.x, player.y - monster.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = player;
      }
    }

    if (target) {
      monster.guardReturnTimer = 0;
      if (bestDistance > 0) {
        monster.facingX = (target.x - monster.x) / bestDistance;
        monster.facingY = (target.y - monster.y) / bestDistance;
      }

      // 벽으로 길을 막았으면 침공 몬스터와 같은 규칙으로 그 벽부터 부순다.
      const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
      if (blocker) {
        this.attackBuilding(monster, blocker, data.damage, data.attackInterval);
      } else if (bestDistance <= data.attackRange) {
        if (monster.attackCooldown <= 0) {
          this.damagePlayer(target, data.damage);
          monster.attackCooldown = data.attackInterval;
          this.markAttack(monster);
        }
      } else {
        this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
      }
      return;
    }

    // 귀환: 콜로니 충돌 반경 바로 바깥까지 다가간 뒤 잠시 서성이다 저장 상태로.
    const homeDistance = Math.hypot(colony.x - monster.x, colony.y - monster.y);
    const arriveDistance = COLONY_RADIUS + monsterRadius(monster) + GUARD_HOME_ARRIVE_MARGIN;
    if (homeDistance > arriveDistance) {
      monster.guardReturnTimer = 0;
      monster.facingX = (colony.x - monster.x) / homeDistance;
      monster.facingY = (colony.y - monster.y) / homeDistance;
      this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
      return;
    }

    monster.guardReturnTimer += dtSeconds;
    if (monster.guardReturnTimer < coloniesData.returnDespawnSeconds) return;

    this.monsters.delete(monster.id);
    colony.guardIds.delete(monster.id);
    // 단계 재보급(settleColoniesOnDayBegan)이 사이에 끼어도 저장분이 상한을 넘지 않게 조인다.
    colony.stored = Math.min(colony.stored + 1, colonyStageData(colony.stage).stored);
  }

  /**
   * 개발 커맨드 전용: 몬스터를 전부 치우면서 콜로니 수호대 장부와 침공 대기열도 함께
   * 비운다 — 장부에 유령 id가 남으면 동시 수호대 상한이 영구히 차서 소환이 멈춘다.
   */
  private clearAllMonsters(): void {
    this.monsters.clear();
    this.monsterGrid.clear();
    this.contingents.length = 0;
    for (const colony of this.colonies.values()) colony.guardIds.clear();
  }

  /**
   * 공격 모션을 켠다. 피해가 실제로 들어간 자리마다 부른다(빗나간 시도에는 안 켠다).
   * `anim`은 재생할 동작 번호 — 검술이 여러 개인 보스만 1이 아닌 값을 넘긴다.
   */
  private markAttack(monster: MonsterEntity, anim = 1): void {
    monster.attackAnimTimer = ATTACK_ANIM_SECONDS;
    monster.attackAnim = anim;
  }

  /** 정화 처리: 단계 보상 지급 후 1단계 빈 껍데기로. 다음 낮에 재보급된다(onDayBegan). */
  private purifyColony(colony: ColonyEntity): void {
    this.core.sharedEnergy += colonyStageData(colony.stage).purifyEnergy;
    colony.stage = 1;
    colony.stored = 0;
    colony.purified = true;
    this.enqueuePersonaEvent('colonyDestroyed');
  }

  /** 살아있는 플레이어 중 (x,y)에서 radius 안에 있는 사람이 하나라도 있는가. */
  private anyAlivePlayerWithin(x: number, y: number, radius: number): boolean {
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (circlesOverlap(player.x, player.y, x, y, radius)) return true;
    }
    return false;
  }

  /**
   * 밤 시작에 콜로니 저장분의 일부를 **복제**해 침공 대기열로 만든다. 저장분 자체는
   * 줄지 않는다 — 줄면 "밤에는 콜로니가 비어 정화가 공짜"라는 허점이 생긴다.
   * 대기열은 tickContingents()가 웨이브와 같은 무리 리듬으로 콜로니 방향에서
   * 내보낸다("콜로니가 있는 방향에서 몰려온다").
   */
  private buildNightContingents(): void {
    this.contingents.length = 0;
    for (const colony of this.colonies.values()) {
      if (colony.purified || colony.stored <= 0) continue;
      const count = Math.floor(colony.stored * coloniesData.waveContributionRatio);
      if (count <= 0) continue;

      const stage = colonyStageData(colony.stage);
      const queue: MonsterType[] = [];
      for (let i = 0; i < count; i += 1) {
        queue.push(stage.types[Math.floor(this.rng() * stage.types.length)] as MonsterType);
      }
      this.contingents.push({ x: colony.x, y: colony.y, queue, timer: 0 });
    }
  }

  /**
   * 새 낮이 시작될 때의 콜로니 정산. 정화된 빈 껍데기는 1단계 저장분으로 재보급되고
   * (정화 즉시 재보급하면 그 자리에서 무한 보상 파밍이 된다 — 하루에 한 번만),
   * 살아남은(정화 안 된) 콜로니는 한 단계 성장한다(저장분 대략 2배, 최대 3단계).
   */
  private settleColoniesOnDayBegan(): void {
    for (const colony of this.colonies.values()) {
      if (colony.purified) {
        colony.purified = false;
        colony.stored = colonyStageData(colony.stage).stored;
      } else {
        colony.stage = Math.min(colony.stage + 1, maxColonyStage());
        colony.stored = colonyStageData(colony.stage).stored;
      }
      colony.guardRespawnTimer = 0;
    }
  }

  /**
   * 침공 복제분을 무리 단위로 내보낸다. 무리 크기/간격은 현재 웨이브 항목을 그대로
   * 따라가 본대와 같은 리듬으로 밀려온다. 밤이 아니면(승리/패배 포함) 대기열만
   * 남고 소진되지 않는데, 어차피 다음 밤 시작에 새로 만들어 덮으므로 문제없다.
   */
  private tickContingents(dtSeconds: number): void {
    if (this.waveManager.currentPhase !== 'night') return;
    const entry = wavesData.waves[this.waveManager.currentWave - 1];
    const groupSize = entry?.groupSize ?? 4;
    const interval = entry?.groupIntervalSeconds ?? 12;

    for (const contingent of this.contingents) {
      if (contingent.queue.length === 0) continue;
      contingent.timer -= dtSeconds;
      if (contingent.timer > 0) continue;
      contingent.timer = interval;

      for (let i = 0; i < groupSize; i += 1) {
        const type = contingent.queue.shift();
        if (!type) break;
        const spawnMonsterR = monstersData[type]?.hitRadius ?? HIT_RADIUS;
        const angle = this.rng() * Math.PI * 2;
        const offset = COLONY_RADIUS + spawnMonsterR + 2;
        this.addMonster(
          type,
          contingent.x + Math.cos(angle) * offset,
          contingent.y + Math.sin(angle) * offset,
        );
      }
    }
  }

  /** 아직 스폰 대기 중인 침공 복제분 총 마릿수. 밤 종료 판정에 산 몬스터처럼 계산된다. */
  private pendingContingentCount(): number {
    let total = 0;
    for (const contingent of this.contingents) total += contingent.queue.length;
    return total;
  }

  /** 살아있는(hp>0) 자원 노드 중 (x,y)에서 가장 가까운 것. 없으면 undefined. */
  private findNearestHarvestableNode(x: number, y: number): ResourceNodeEntity | undefined {
    let nearest: ResourceNodeEntity | undefined;
    let nearestDistance = Infinity;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const distance = Math.hypot(node.x - x, node.y - y);
      if (distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /**
   * 티모시를 (targetX, targetY) 방향으로 한 스텝 이동시킨다. `movePlayer`와 같은
   * 3단계 폴백(전체 이동 → X축만 → Y축만)을 쓰고, 장애물 판정도 플레이어와 같은
   * `isBlockedForPlayer`를 그대로 쓴다 — 몬스터 전용 판정/분리 벡터는 필요 없다(1마리뿐).
   */
  private moveCompanionToward(targetX: number, targetY: number, dtSeconds: number): void {
    const companion = this.companion;
    const dx = targetX - companion.x;
    const dy = targetY - companion.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) return;

    const dirX = dx / distance;
    const dirY = dy / distance;
    companion.facingX = dirX;
    companion.facingY = dirY;

    const step = companionData.moveSpeed * dtSeconds;
    const full = { x: companion.x + dirX * step, y: companion.y + dirY * step };
    if (!this.isBlockedForPlayer(full.x, full.y)) {
      companion.x = full.x;
      companion.y = full.y;
      return;
    }

    const xOnly = { x: companion.x + dirX * step, y: companion.y };
    if (!this.isBlockedForPlayer(xOnly.x, xOnly.y)) {
      companion.x = xOnly.x;
      return;
    }

    const yOnly = { x: companion.x, y: companion.y + dirY * step };
    if (!this.isBlockedForPlayer(yOnly.x, yOnly.y)) {
      companion.y = yOnly.y;
    }
  }

  /**
   * AI 동반자(티모시) 상태머신 — 자원 채집/운반만 한다(전투/대사 없음,
   * docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
   */
  private tickCompanion(dtSeconds: number): void {
    const companion = this.companion;
    if (companion.state === 'downed') return;

    if (companion.state === 'seeking') {
      const node = this.findNearestHarvestableNode(companion.x, companion.y);
      if (!node) return; // 캘 게 없으면 그 자리에서 대기
      companion.targetNodeId = node.id;
      companion.state = 'traveling';
      return;
    }

    if (companion.state === 'traveling') {
      const node = companion.targetNodeId ? this.resourceNodes.get(companion.targetNodeId) : undefined;
      if (!node || node.hp <= 0) {
        // 다른 사람이 먼저 캤을 수도 있다 — 노드가 사라졌으면 다시 찾는다.
        companion.targetNodeId = undefined;
        companion.state = 'seeking';
        return;
      }
      const distance = Math.hypot(node.x - companion.x, node.y - companion.y);
      if (distance <= companionData.harvestRange) {
        companion.state = 'harvesting';
      } else {
        this.moveCompanionToward(node.x, node.y, dtSeconds);
      }
      return;
    }

    if (companion.state === 'harvesting') {
      const node = companion.targetNodeId ? this.resourceNodes.get(companion.targetNodeId) : undefined;
      if (!node || node.hp <= 0) {
        companion.targetNodeId = undefined;
        companion.state = 'seeking';
        return;
      }
      companion.harvestTimer -= dtSeconds;
      if (companion.harvestTimer > 0) return;
      companion.harvestTimer = companionData.harvestIntervalSeconds;

      const data = resourcesData[node.type];
      node.hp = Math.max(0, node.hp - companionData.harvestDamage);
      if (node.hp > 0) return;

      // 사람이 캘 때와 같은 고갈 부수효과(리스폰 타이머/장애물 재계산) — 다른 점은
      // 바닥에 드랍 아이템을 만들지 않고 바로 들고 간다는 것뿐이다(인벤토리/줍기 UI가
      // 없는 봇이라 그 단계를 생략한다).
      node.respawnTimer = data.respawnSeconds;
      this.rebuildResourceObstacleCells();
      this.recomputeFlowField();
      if (node.type === 'wood') companion.carriedWood += data.yieldOnDeplete;
      else companion.carriedStone += data.yieldOnDeplete;

      companion.targetNodeId = undefined;
      const carried = companion.carriedWood + companion.carriedStone;
      companion.state = carried >= companionData.capacity ? 'returning' : 'seeking';
      return;
    }

    if (companion.state === 'returning') {
      if (isWithinCoreInteract(companion.x, companion.y)) {
        companion.state = 'depositing';
      } else {
        this.moveCompanionToward(0, 0, dtSeconds);
      }
      return;
    }

    // depositing
    if (companion.carriedWood > 0) this.core.storage.add('wood', companion.carriedWood);
    if (companion.carriedStone > 0) this.core.storage.add('stone', companion.carriedStone);
    companion.carriedWood = 0;
    companion.carriedStone = 0;
    companion.state = 'seeking';
  }

  /**
   * 몬스터의 정교한 추격/리시 로직(resolveAggroTarget)은 건드리지 않고, 단순 근접
   * 판정만으로 티모시를 노출시킨다 — 어떤 몬스터든 자기 공격 사거리 안에 티모시가
   * 있으면 때린다(추격 대상인지와 무관하다). 플레이어 공격 쿨다운과는 별도
   * 필드(`companionAttackCooldown`)를 써서 서로 간섭하지 않는다.
   */
  private tickCompanionDamage(dtSeconds: number): void {
    if (this.companion.state === 'downed') return;
    for (const monster of this.monsters.values()) {
      monster.companionAttackCooldown = Math.max(0, monster.companionAttackCooldown - dtSeconds);
      const data = monstersData[monster.type];
      const distance = Math.hypot(this.companion.x - monster.x, this.companion.y - monster.y);
      if (distance > data.attackRange) continue;
      if (monster.companionAttackCooldown > 0) continue;
      this.damageCompanion(data.damage);
      monster.companionAttackCooldown = data.attackInterval;
      this.markAttack(monster);
    }
  }

  private damageCompanion(amount: number): void {
    this.companion.hp = Math.max(0, this.companion.hp - amount);
    if (this.companion.hp <= 0) {
      this.companion.state = 'downed';
      // tickCompanionDamage()가 이미 'downed' 상태를 걸러내므로 이 전환은 딱 한 번만 일어난다.
      const nearestId = this.findNearestPlayerId(this.companion.x, this.companion.y);
      if (nearestId) this.enqueueCompanionPersonaEvent('companionDowned', nearestId);
    }
  }

  /**
   * 몬스터 행동: 어그로 반경 + 시야각(120도) 안에 플레이어가 있으면 직접 추격(돌진형/보스),
   * 아니면 Flow Field를 따라 코어로 향한다(잡몹/탱커형). 사거리 안에 들어오면 이동을
   * 멈추고 공격 주기(attackInterval)마다 대미지를 준다. 실제 이동에는 군집 분리를
   * 섞어서(moveMonster) 여러 마리가 완전히 겹쳐 스택되지 않게 한다.
   *
   * 살아있는 목표(추격 타겟/코어)보다 **막는 건축물이 항상 우선**이다 — 처음엔 반대로
   * "타겟이 사거리 안이면 무조건 타겟부터"였는데, 그러면 코어/플레이어를 벽으로 완전히
   * 둘러싸도 몬스터가 raw 거리만으로 사거리 판정을 통과해서 벽을 그냥 뚫고 공격해
   * 버렸다(실제로 코어를 8방향 벽으로 둘러싼 뒤 관찰해서 재현 확인, docs/backend/27) —
   * 벽이 있으나 마나였다. 이제는 공격 사거리 안에 이동을 막는 건축물이 있으면 그것부터
   * 처리하고, 없을 때만 타겟/코어를 공격한다(docs/backend/24, 기술명세 §5.3 "막힘 감지"의
   * 단순화 버전 — 정밀한 우회 비용 비교 대신 기존 근접 판정과 동일한 반경 기반 규칙을 쓴다).
   *
   * `facingX/Y`는 이 함수가 매 틱 끝에 갱신한다 — 추격 중이면 타겟 방향, 코어를 공격
   * 중이면 코어 방향, 그 외엔 Flow Field 방향. 전부 이미 계산해 둔 벡터라 이 갱신
   * 자체는 추가 비용이 거의 없다(대입 두 번).
   */
  private tickMonsters(dtSeconds: number): void {
    // 이번 틱 시작 시점 기준으로 그리드를 다시 채운다 — moveMonster를 안 거치고
    // 몬스터 좌표가 바뀔 수 있는 경로(테스트의 직접 대입 등, fireWeapon과 같은 이유)를
    // 대비한 안전망이다. 이후 이 루프 안에서 moveMonster가 호출될 때마다 증분
    // 갱신되므로(try/finally), 이 틱 안에서는 항상 "지금까지 처리된 몬스터는 최신
    // 위치, 아직 처리 안 된 몬스터는 이번 틱 시작 위치"를 정확히 반영한다 — 기존
    // (그리드 도입 전) computeSeparation이 살아있는 this.monsters를 그대로 순회하며
    // 갖던 것과 같은 순서 의존적 동작이다.
    this.rebuildMonsterGrid();
    for (const monster of this.monsters.values()) {
      const data = monstersData[monster.type];
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dtSeconds);
      monster.attackAnimTimer = Math.max(0, monster.attackAnimTimer - dtSeconds);
      if (monster.attackAnimTimer === 0) monster.attackAnim = 0;
      for (let i = 0; i < monster.meleeCooldowns.length; i += 1) {
        monster.meleeCooldowns[i] = Math.max(0, monster.meleeCooldowns[i]! - dtSeconds);
      }

      // 보스 특수 패턴이 이번 틱의 이동/공격을 전부 처리했으면(예고 중이라 멈춰 있거나
      // 돌진 중이거나) 아래 일반 추격/이동 로직은 건너뛴다. chargeAttack/slamAttack이
      // 없는 타입(잡몹 등)은 매 틱 이 검사 하나만 거치고 바로 false를 반환한다.
      if (this.tickBossPattern(monster, data, dtSeconds)) continue;

      // 콜로니 수호대는 코어 침공 AI를 아예 타지 않는다 — 리시 안 플레이어 요격,
      // 없으면 귀환 후 저장 복귀가 전부다.
      if (monster.homeColonyId) {
        this.tickGuard(monster, data, dtSeconds);
        continue;
      }

      const target = data.aggroRadius
        ? this.resolveAggroTarget(monster, data.aggroRadius)
        : undefined;

      if (target) {
        const distance = Math.hypot(target.x - monster.x, target.y - monster.y);
        // 거리가 0이면 방향을 정의할 수 없으니(같은 좌표) 바라보던 방향을 그대로 둔다.
        if (distance > 0) {
          monster.facingX = (target.x - monster.x) / distance;
          monster.facingY = (target.y - monster.y) / distance;
        }

        const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
        if (blocker) {
          this.attackBuilding(monster, blocker, data.damage, data.attackInterval);
        } else if (distance <= data.attackRange) {
          if (monster.attackCooldown <= 0) {
            this.damagePlayer(target, data.damage);
            monster.attackCooldown = data.attackInterval;
            this.markAttack(monster);
          }
        } else {
          // 자원 노드/콜로니가 경로를 막아도 moveMonster가 축 슬라이딩으로 알아서
          // 미끄러지며 우회한다(docs/backend/40) — 여기서 따로 멈출지 말지 검사하지 않는다.
          this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
        }
        continue;
      }

      const distanceToCore = Math.hypot(monster.x, monster.y);

      const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
      if (blocker) {
        this.attackBuilding(monster, blocker, data.damage, data.attackInterval);
        continue;
      }

      // 코어 "도달"은 중심 거리가 아니라 발자국 가장자리 기준이다 — 어느 방향에서
      // 와도 보이는 받침대 앞에서 멈춰 때린다.
      if (coreDistance(monster.x, monster.y) <= data.attackRange) {
        if (distanceToCore > 0) {
          monster.facingX = -monster.x / distanceToCore;
          monster.facingY = -monster.y / distanceToCore;
        }
        if (monster.attackCooldown <= 0) {
          this.core.hp = Math.max(0, this.core.hp - data.damage);
          monster.attackCooldown = data.attackInterval;
          this.markAttack(monster);
        }
        continue;
      }

      // 코어까지 막힌 셀이 없으면 Flow Field(격자 8방향으로만 방향을 낼 수 있어 각도가
      // 유한하게 끊긴다) 대신 코어를 향한 진짜 연속각으로 직진시킨다 — 실제로 피할
      // 장애물이 있을 때만 Flow Field 방향으로 우회한다(backend/21).
      const direct = this.flowField.hasLineOfSight(monster.x, monster.y, 0, 0);
      let dir = direct
        ? { x: -monster.x / distanceToCore, y: -monster.y / distanceToCore }
        : this.flowField.sampleDirection(monster.x, monster.y);

      if (dir.x === 0 && dir.y === 0) {
        // Flow Field로도 도달 경로를 못 찾은 경우 — 예를 들어 코어를 건축물로 완전히
        // 둘러싸면 Dijkstra가 그 안쪽에 아예 도달을 못 해서 바깥의 모든 셀이 도달 불가로
        // 남는다. 그렇다고 몬스터를 그 자리에 멈춰 세우면 "건물로 코어를 완전히 둘러싸면
        // 무적이 된다"는 방어 게임으로선 말이 안 되는 허점이 생긴다. 우회로가 없어도
        // 코어를 향해 계속 직진시켜서, 결국 가로막은 건축물에 부딪히면(사거리 안에
        // 들어오면) 위 `findBlockingBuildingInRange`가 잡아서 부수기 시작하게 한다.
        dir = { x: -monster.x / distanceToCore, y: -monster.y / distanceToCore };
      }

      monster.facingX = dir.x;
      monster.facingY = dir.y;

      // FlowField는 셀(16px) 단위로만 "막혔다/열렸다"를 판정하는데, 자원 노드/콜로니의
      // 실제 충돌 원은 셀 경계와 딱 맞아떨어지지 않는다 — 그래서 셀 기준으로는
      // "우회하는 경로"로 보여도, 그 경로가 실제 충돌 원 아주 가까이(또는 코너를 스치듯)
      // 지나가는 순간이 생길 수 있다. moveMonster의 축 슬라이딩이 그 마지막 몇십 px의
      // 정밀도를 담당한다(docs/backend/40) — 셀 기반 라우팅은 큰 그림의 우회만 맡는다.
      this.moveMonster(monster, dir.x, dir.y, data.speed, dtSeconds);
    }
  }

  /**
   * 보스 전용 특수 패턴(돌진/광역)의 상태 전이를 한 틱 진행한다. `chargeAttack`/
   * `slamAttack` 데이터가 둘 다 없는 타입(잡몹 등)은 이 검사 하나만 거치고 즉시
   * false를 반환해서 일반 몹의 틱 비용을 사실상 늘리지 않는다.
   *
   * true를 반환하면 이번 틱의 이동/공격을 이 메서드가 전부 처리했다는 뜻이라, 호출부
   * (tickMonsters)는 일반 추격/코어 공격/Flow Field 이동 로직을 건너뛰어야 한다 —
   * 예고 중에는 몬스터가 그 자리에 멈춰 있어야 화면에 미리 보여준 위험 범위와 실제
   * 판정 범위가 어긋나지 않는다.
   */
  private tickBossPattern(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    if (!data.chargeAttack && !data.slamAttack && !data.meleeAttacks) return false;

    switch (monster.pattern.kind) {
      case 'meleeSwing':
        return this.tickMeleeSwing(monster, data, dtSeconds);
      case 'meleeRecover':
        return this.tickMeleeRecover(monster, dtSeconds);
      case 'chargeTelegraph':
        return this.tickChargeTelegraph(monster, data, dtSeconds);
      case 'charging':
        return this.tickCharging(monster, data, dtSeconds);
      case 'slamTelegraph':
        return this.tickSlamTelegraph(monster, data, dtSeconds);
      case 'idle':
        return this.tryStartBossPattern(monster, data, dtSeconds);
    }
  }

  /**
   * 유휴 상태에서 특수 패턴 발동을 시도한다. 쿨다운이 남아있거나 아그로 타겟이 없으면
   * false를 반환해서 그 틱은 평소처럼(추격/코어 공격/이동) 행동한다 — 특수 패턴은
   * 평소 행동을 "대체"하는 것이지 별도로 얹는 게 아니다.
   */
  private tryStartBossPattern(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    monster.specialAttackCooldown = Math.max(0, monster.specialAttackCooldown - dtSeconds);
    if (monster.specialAttackCooldown > 0) return false;

    const target = data.aggroRadius ? this.resolveAggroTarget(monster, data.aggroRadius) : undefined;
    if (!target) return false;

    const dxToTarget = target.x - monster.x;
    const dyToTarget = target.y - monster.y;
    const targetDistance = Math.hypot(dxToTarget, dyToTarget);

    // 근접 검술을 가진 보스는 그쪽을 먼저 본다 — 사거리가 닿고 쿨다운이 끝난 기술
    // 중에서 무작위로 하나. 거리로 후보가 갈리므로 붙으면 짧은 기술, 떨어지면 긴
    // 기술이 나온다(항상 같은 순서면 패턴이 아니라 그냥 외우는 게 된다).
    if (data.meleeAttacks) {
      const ready: number[] = [];
      data.meleeAttacks.forEach((attack, index) => {
        if ((monster.meleeCooldowns[index] ?? 0) > 0) return;
        // 타격이 여러 번인 기술은 그중 가장 먼 사거리로 후보를 가린다.
        const reach = Math.max(...attack.hits.map((hit) => hit.range));
        if (targetDistance > reach) return;
        ready.push(index);
      });

      if (ready.length > 0) {
        const index = ready[Math.floor(this.rng() * ready.length)]!;
        const attack = data.meleeAttacks[index]!;
        const dirX = targetDistance > 0 ? dxToTarget / targetDistance : monster.facingX;
        const dirY = targetDistance > 0 ? dyToTarget / targetDistance : monster.facingY;
        monster.facingX = dirX;
        monster.facingY = dirY;
        monster.pattern = { kind: 'meleeSwing', elapsed: 0, index, nextHit: 0, dirX, dirY };
        return true;
      }
      // 쓸 수 있는 검술이 없으면(전부 쿨다운이거나 너무 멀다) 평소처럼 추격한다.
      if (!data.chargeAttack && !data.slamAttack) return false;
    }

    const canCharge = !!data.chargeAttack;
    const canSlam = !!data.slamAttack;
    // 둘 다 가능하면 매번 무작위로 고른다 — 항상 같은 순서로만 나오면 패턴이 아니라
    // 그냥 다음 공격을 외우는 게 돼버린다.
    const useCharge = canCharge && (!canSlam || this.rng() < 0.5);

    const dirX = targetDistance > 0 ? dxToTarget / targetDistance : monster.facingX;
    const dirY = targetDistance > 0 ? dyToTarget / targetDistance : monster.facingY;
    monster.facingX = dirX;
    monster.facingY = dirY;

    if (useCharge) {
      const charge = data.chargeAttack!;
      monster.pattern = {
        kind: 'chargeTelegraph',
        timer: charge.telegraphSeconds,
        total: charge.telegraphSeconds,
        dirX,
        dirY,
      };
    } else {
      const slam = data.slamAttack!;
      // 타겟의 "현재" 위치에 지점을 고정한다 — 예고가 끝날 때까지 타겟을 계속 따라가면
      // 미리 보여준 범위 밖으로 피해도 소용없어진다.
      monster.pattern = {
        kind: 'slamTelegraph',
        timer: slam.telegraphSeconds,
        total: slam.telegraphSeconds,
        x: target.x,
        y: target.y,
      };
    }
    return true;
  }

  /**
   * 근접 검술 진행 — 무기를 휘두르는 동안 멈춰 서 있는다. **방향은 시작 시점에
   * 고정한다**: 동작 내내 플레이어를 따라 돌면 "동작을 보고 옆으로 빠진다"는 이 기술의
   * 유일한 대응 수단이 사라진다.
   *
   * 경과 시간을 재면서 각 타격의 시점을 넘길 때마다 판정을 넣는다. 한 틱이 여러 타격
   * 시점을 한꺼번에 넘길 수도 있어서(느린 틱) `while`로 밀린 것까지 전부 처리한다 —
   * 안 그러면 2연타 중 하나가 조용히 사라진다.
   */
  private tickMeleeSwing(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'meleeSwing' }>;
    const attack = data.meleeAttacks?.[pattern.index];
    if (!attack) {
      monster.pattern = { kind: 'idle' };
      return false;
    }

    monster.facingX = pattern.dirX;
    monster.facingY = pattern.dirY;
    pattern.elapsed += dtSeconds;

    while (
      pattern.nextHit < attack.hits.length &&
      pattern.elapsed >= attack.hits[pattern.nextHit]!.atSeconds
    ) {
      this.resolveMeleeHit(monster, attack, attack.hits[pattern.nextHit]!, pattern.dirX, pattern.dirY);
      pattern.nextHit += 1;
    }

    if (pattern.nextHit < attack.hits.length) return true;

    monster.meleeCooldowns[pattern.index] = attack.cooldown;
    monster.pattern = { kind: 'meleeRecover', timer: attack.recoverSeconds };
    return true;
  }

  /** 검을 휘두른 뒤 경직. 그냥 시간만 흘려보낸다(이동·공격 없음). */
  private tickMeleeRecover(monster: MonsterEntity, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'meleeRecover' }>;
    pattern.timer -= dtSeconds;
    if (pattern.timer <= 0) monster.pattern = { kind: 'idle' };
    return true;
  }

  /**
   * 검술 판정 한 번. 플레이어와 티모시 모두 부채꼴 안에 있으면 맞는다 —
   * 플레이어 무기와 **같은 함수**(withinMeleeArc)를 써서 "보이는 부채꼴 = 맞는 범위"
   * 규칙이 양쪽에서 어긋나지 않게 한다.
   */
  private resolveMeleeHit(
    monster: MonsterEntity,
    attack: MeleeAttackData,
    swing: MeleeHitData,
    dirX: number,
    dirY: number,
  ): void {
    const hit = {
      // ownerId는 "누구의 명중으로 칠지"를 가리는 값이라 플레이어 무기에만 의미가
      // 있다(withinMeleeArc는 쓰지 않는다). 몬스터 공격에는 주인이 없으니 몬스터
      // 자신의 id를 넣어 형태만 맞춘다.
      ownerId: monster.id,
      originX: monster.x,
      originY: monster.y,
      range: swing.range,
      aimAngle: Math.atan2(dirY, dirX),
      // 360도면 halfArc가 π가 되어 withinMeleeArc가 방향을 아예 안 본다(전방향 광역).
      halfArc: (swing.arc * Math.PI) / 360,
      damage: swing.damage,
    };

    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (!withinMeleeArc(hit, player.x, player.y, HIT_RADIUS)) continue;
      this.damagePlayer(player, swing.damage);
    }
    if (this.companion.state !== 'downed' && withinMeleeArc(hit, this.companion.x, this.companion.y, HIT_RADIUS)) {
      this.damageCompanion(swing.damage);
    }

    this.markAttack(monster, attack.anim);
  }

  /** 돌진 예고 — 그 자리에 멈춰 방향을 유지하다가, 시간이 다 되면 실제 돌진으로 전이한다. */
  private tickChargeTelegraph(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'chargeTelegraph' }>;
    monster.facingX = pattern.dirX;
    monster.facingY = pattern.dirY;
    pattern.timer -= dtSeconds;
    if (pattern.timer > 0) return true;

    const charge = data.chargeAttack!;
    monster.pattern = {
      kind: 'charging',
      timer: charge.duration,
      dirX: pattern.dirX,
      dirY: pattern.dirY,
      hitPlayerIds: new Set(),
    };
    return true;
  }

  /**
   * 실제 돌진 실행. 예고 때 고정한 방향으로 `chargeAttack.speed`만큼 빠르게 이동하며,
   * 경로 폭(`width`) 안에 들어온 플레이어를 때린다 — 한 번의 돌진 동안 같은 플레이어를
   * 여러 틱에 걸쳐 중복으로 맞히지 않도록 `hitPlayerIds`로 1회만 적중시킨다.
   */
  private tickCharging(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'charging' }>;
    const charge = data.chargeAttack!;

    monster.facingX = pattern.dirX;
    monster.facingY = pattern.dirY;
    this.moveMonster(monster, pattern.dirX, pattern.dirY, charge.speed, dtSeconds);

    const hitRadius = HIT_RADIUS + charge.width / 2;
    for (const player of this.players.values()) {
      if (player.hp <= 0 || pattern.hitPlayerIds.has(player.id)) continue;
      if (circlesOverlap(monster.x, monster.y, player.x, player.y, hitRadius)) {
        this.damagePlayer(player, charge.damage);
        pattern.hitPlayerIds.add(player.id);
      }
    }

    pattern.timer -= dtSeconds;
    if (pattern.timer <= 0) {
      monster.pattern = { kind: 'idle' };
      monster.specialAttackCooldown = charge.cooldown;
    }
    return true;
  }

  /** 광역 예고 — 그 자리(타겟 위치에 멈춘 지점)에서 대기하다가, 시간이 다 되면 즉시 범위 피해를 준다. */
  private tickSlamTelegraph(monster: MonsterEntity, data: MonsterData, dtSeconds: number): boolean {
    const pattern = monster.pattern as Extract<BossPatternState, { kind: 'slamTelegraph' }>;
    pattern.timer -= dtSeconds;
    if (pattern.timer > 0) return true;

    const slam = data.slamAttack!;
    const hitRadius = slam.radius + HIT_RADIUS;
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (circlesOverlap(pattern.x, pattern.y, player.x, player.y, hitRadius)) {
        this.damagePlayer(player, slam.damage);
      }
    }

    monster.pattern = { kind: 'idle' };
    monster.specialAttackCooldown = slam.cooldown;
    return true;
  }

  /** 공격 사거리 안의, 이동을 막는(blocksMovement) 건축물 중 가장 가까운 것을 찾는다. */
  private findBlockingBuildingInRange(
    monster: MonsterEntity,
    range: number,
  ): BuildingEntity | undefined {
    let nearest: BuildingEntity | undefined;
    let nearestDistance = range;

    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      const distance = Math.hypot(building.x - monster.x, building.y - monster.y);
      if (distance <= nearestDistance) {
        nearest = building;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  /**
   * 이동을 막는(blocksMovement) 건축물, 그리고 코어/자원 노드/콜로니와 겹치는지
   * 검사한다(플레이어 하드 충돌, docs/backend/38). 건축물은 `blocksMovement`
   * 타입만 막지만 코어/자원/콜로니는 예외 없이 전부 막는다(사용자가 "코어, 나무,
   * 돌, 콜로니 다" 통과 못 하게 해달라고 명시).
   */
  private isBlockedForPlayer(x: number, y: number): boolean {
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      if (circlesOverlap(x, y, building.x, building.y, PLAYER_BUILDING_COLLISION_RADIUS)) {
        return true;
      }
    }
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈된 자리는 통과할 수 있다(docs/backend/39)
      const radius = HIT_RADIUS + resourcesData[node.type].hitRadius;
      if (circlesOverlap(x, y, node.x, node.y, radius)) return true;
    }
    for (const colony of this.colonies.values()) {
      if (circlesOverlap(x, y, colony.x, colony.y, PLAYER_COLONY_COLLISION_RADIUS)) return true;
    }
    // 코어는 원이 아니라 8각 발자국이다(coreShape.ts) — 스프라이트 윤곽 그대로 막는다.
    if (coreDistance(x, y) < HIT_RADIUS) return true;
    return false;
  }

  /**
   * 몬스터가 (x,y)에 있다고 가정했을 때 자원 노드/콜로니와 겹치는지 검사한다.
   * `isBlockedForPlayer`와 같은 모양이지만 반경이 `HIT_RADIUS`(플레이어 고정값) 대신
   * 인자로 받은 몬스터 반경(`monsterRadius(monster)`, 타입마다 다름)이다.
   *
   * 건축물은 여기서 다루지 않는다 — 몬스터에게 건축물은 "부수는 대상"이라
   * `findBlockingBuildingInRange`가 따로 처리한다(가로막으면 멈추는 게 아니라
   * 공격해서 없앤다). 코어도 다루지 않는다 — 몬스터의 목표 자체라 막으면 안 된다
   * (docs/backend/38).
   */
  /**
   * `crushes`가 true면 자원 노드/콜로니를 통과한다(거구 보스). 회피가 물리적으로
   * 불가능한 덩치라 막아봐야 갈리기만 하고, 거대한 보스가 나무 한 그루에 멈춰 서는
   * 그림도 이상하다(§MonsterData.crushesObstacles).
   */
  private isBlockedForMonster(
    x: number,
    y: number,
    monsterR: number,
    crushes = false,
  ): boolean {
    if (crushes) return false;
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈된 자리는 통과할 수 있다(docs/backend/39)
      if (circlesOverlap(x, y, node.x, node.y, monsterR + resourcesData[node.type].hitRadius)) {
        return true;
      }
    }
    for (const colony of this.colonies.values()) {
      if (circlesOverlap(x, y, colony.x, colony.y, monsterR + COLONY_RADIUS)) return true;
    }
    return false;
  }

  /**
   * (x,y) 기준으로 "경계에 가장 바짝 붙어 있는" 자원 노드/콜로니의 중심 좌표를 찾는다.
   * `moveMonster`의 접선(탄젠트) 미끄러짐 폴백이 쓴다 — 원형 장애물은 어느 방향이
   * 막혔는지가 아니라 "장애물 중심에서 몬스터로 향하는 방향"을 알아야 그 방향에
   * 수직인 접선으로 미끄러뜨릴 수 있다. 거리에서 막힘 반경을 뺀 값(음수면 이미
   * 겹친 것)이 가장 작은 후보를 고른다 — 지금 이 몬스터를 막고 있는 바로 그
   * 장애물을 찾기 위함이다.
   */
  private findNearestObstacleCenter(
    x: number,
    y: number,
    monsterR: number,
  ): { x: number; y: number } | undefined {
    let nearest: { x: number; y: number } | undefined;
    let nearestGap = Infinity;

    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue;
      const gap = Math.hypot(node.x - x, node.y - y) - (monsterR + resourcesData[node.type].hitRadius);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: node.x, y: node.y };
      }
    }
    for (const colony of this.colonies.values()) {
      const gap = Math.hypot(colony.x - x, colony.y - y) - (monsterR + COLONY_RADIUS);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = { x: colony.x, y: colony.y };
      }
    }

    return nearest;
  }

  /**
   * 플레이어를 건축물과 겹치지 않는 선에서 이동시킨다.
   *
   * 전체 이동이 막히면 X축만, 그것도 막히면 Y축만 시도한다(축 슬라이딩) — 벽에 대각선으로
   * 부딪혔을 때 완전히 멈추는 대신 벽을 따라 미끄러지듯 이동하게 하기 위함이다.
   */
  private movePlayer(
    player: PlayerEntity,
    moveX: number,
    moveY: number,
    dtSeconds: number,
  ): void {
    const full = stepPosition(player.x, player.y, moveX, moveY, dtSeconds);
    if (!this.isBlockedForPlayer(full.x, full.y)) {
      player.x = full.x;
      player.y = full.y;
      return;
    }

    const xOnly = stepPosition(player.x, player.y, moveX, 0, dtSeconds);
    if (!this.isBlockedForPlayer(xOnly.x, xOnly.y)) {
      player.x = xOnly.x;
      player.y = xOnly.y;
      return;
    }

    const yOnly = stepPosition(player.x, player.y, 0, moveY, dtSeconds);
    if (!this.isBlockedForPlayer(yOnly.x, yOnly.y)) {
      player.x = yOnly.x;
      player.y = yOnly.y;
    }
  }

  /** 건축물 공격. HP가 0이 되면 제거하고 Flow Field를 다시 계산한다(막던 셀이 열렸으므로). */
  private attackBuilding(
    monster: MonsterEntity,
    building: BuildingEntity,
    damage: number,
    attackInterval: number,
  ): void {
    if (monster.attackCooldown > 0) return;

    building.hp = Math.max(0, building.hp - damage);
    monster.attackCooldown = attackInterval;
    this.markAttack(monster);

    if (building.hp <= 0) {
      this.buildings.remove(building.id);
      this.recomputeFlowField();
    }
  }

  /**
   * 어그로 타겟에 히스테리시스(leash)를 둔다. 매 틱 "가장 가까운 플레이어"를 새로
   * 계산하면 두 플레이어가 아그로 반경 경계 부근에 걸쳐 있을 때 타겟이 계속 바뀌면서
   * 이동 방향이 떨린다. 한 번 잡은 타겟은 죽거나(hp 0) 아그로 반경의
   * `AGGRO_LEASH_MULTIPLIER`배 밖으로 벗어나기 전까지 그대로 유지한다.
   */
  private resolveAggroTarget(monster: MonsterEntity, aggroRadius: number): PlayerEntity | undefined {
    const current = monster.targetPlayerId ? this.players.get(monster.targetPlayerId) : undefined;
    if (current && current.hp > 0) {
      const distance = Math.hypot(current.x - monster.x, current.y - monster.y);
      if (distance <= aggroRadius * AGGRO_LEASH_MULTIPLIER) return current;
    }

    const next = this.findNearestPlayer(monster, aggroRadius);
    monster.targetPlayerId = next?.id;
    return next;
  }

  /** 근처 몬스터가 겹치지 않도록 밀어내는 벡터(군집 분리, 기술명세 §5.3)를 계산한다. */
  /**
   * monsterGrid를 `this.monsters`의 현재 좌표로 통째로 다시 채운다. 몬스터 수만큼(O(M))
   * 이라 싸다 — moveMonster()를 거치지 않고 좌표가 바뀔 수 있는 지점(틱 시작 시점,
   * fireWeapon 진입 시점) 앞에서 호출해 그리드가 항상 최신 상태에서 출발하게 한다.
   */
  private rebuildMonsterGrid(): void {
    this.monsterGrid.clear();
    for (const monster of this.monsters.values()) {
      this.monsterGrid.insert(monster.id, monster.x, monster.y);
    }
  }

  private computeSeparation(monster: MonsterEntity): { x: number; y: number } {
    let x = 0;
    let y = 0;

    // 전체 몬스터를 다 보는 대신, SEPARATION_RADIUS가 걸치는 격자 칸의 후보만 본다
    // (docs/backend/45) — 판정 자체(거리 < SEPARATION_RADIUS)는 그대로라 결과는 같다.
    const candidateIds = this.monsterGrid.queryRadius(monster.x, monster.y, SEPARATION_RADIUS);
    for (const otherId of candidateIds) {
      if (otherId === monster.id) continue;
      const other = this.monsters.get(otherId);
      if (!other) continue; // 그리드 갱신과 monsters 삭제 사이 타이밍 상 이론상만 존재하는 방어선
      const dx = monster.x - other.x;
      const dy = monster.y - other.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < SEPARATION_RADIUS) {
        const weight = (SEPARATION_RADIUS - distance) / SEPARATION_RADIUS;
        x += (dx / distance) * weight;
        y += (dy / distance) * weight;
      }
    }

    return { x, y };
  }

  /**
   * 주 이동 방향(단위 벡터일 필요 없음)에 군집 분리를 더하고, 자원 노드/콜로니에
   * 막히면 미끄러뜨려서 이동시킨다.
   *
   * **분리력 계산**: 주 방향과 분리 벡터를 먼저 더한 뒤 그 합을 단위 벡터로
   * 정규화하던 예전 방식은, 몬스터가 코어와 일직선(예: y=0 축)에 있을 때 분리력이
   * 주 방향과 같은 축 위에서만 작용하면 정규화 후 결국 둘 다 똑같은 단위 벡터로
   * 수렴해버려 — 분리력의 세기 차이가 사라지고 두 몬스터가 완전히 같은 거리만큼
   * 이동해 간격이 전혀 벌어지지 않는 버그가 있었다. 주 방향은 그 자체로 단위
   * 벡터로 정규화해 속도를 정하고, 분리 벡터는 별도의 변위로 그 위에 더해야
   * 몬스터마다 실제로 받는 분리력 세기가 이동 결과에 반영된다.
   *
   * **장애물 회피(docs/backend/40)**: 목적지가 자원 노드/콜로니와 겹치면 그
   * 자리에 완전히 멈추던 이전 방식(`findBlockingStaticObstacle`, docs/backend/38~39)은
   * 추격 중이던 몬스터가 경로의 자원 노드 하나에 막혀 영원히 멈춰버리는 버그,
   * 그리고 그렇게 멈춘 몬스터가 시야각도 같이 얼어붙어 근처를 스쳐 지나가는
   * 플레이어를 다시는 인지 못 하는 버그로 이어졌다. `movePlayer`/`isBlockedForPlayer`가
   * 쓰던 축 슬라이딩("전체 이동이 막히면 X축만, 그것도 막히면 Y축만")을 그대로
   * 옮겨 왔지만, 이것만으로는 부족했다 — 그 패턴은 **벽 같은 직선 장애물**
   * 전제라, 목표가 원형 장애물 중심과 거의 같은 x 또는 y 좌표에 있으면 X축
   * 이동도 Y축 이동도 둘 다 그 원 안으로 다시 파고드는 경우가 실제로 있다
   * (대각선 추격 경로가 자원 노드를 스치는 상황을 500틱 이상 추적해서 재현·
   * 확인). 그래서 셋째 폴백으로 **접선(탄젠트) 미끄러짐**을 추가했다: 장애물
   * 중심→몬스터 방향 벡터에 수직인 두 방향 중, 원래 가려던 방향과 더 가까운
   * 쪽으로 미끄러뜨린다 — 원의 표면을 따라 도는 동작이라 X/Y 축 슬라이딩이
   * 실패하는 바로 그 상황(장애물이 목표 방향의 정면을 가로막을 때)에서 특히
   * 잘 통한다.
   */
  private moveMonster(
    monster: MonsterEntity,
    dirX: number,
    dirY: number,
    speed: number,
    dtSeconds: number,
  ): void {
    // 아래 본문 안의 여러 return 지점(자유 이동/축 슬라이딩/접선 미끄러짐/탈출 점프)
    // 중 어느 쪽으로 끝나든 monster.x/y가 바뀔 수 있다 — try/finally로 감싸서
    // "몬스터 위치가 바뀌면 그리드도 같이 바뀐다"를 한 곳에서 보장한다(개별 return마다
    // 그리드 갱신 호출을 넣으면 새 return이 추가될 때 빠뜨리기 쉽다).
    try {
      this.moveMonsterInner(monster, dirX, dirY, speed, dtSeconds);
    } finally {
      this.monsterGrid.updateEntry(monster.id, monster.x, monster.y);
    }
  }

  private moveMonsterInner(
    monster: MonsterEntity,
    dirX: number,
    dirY: number,
    speed: number,
    dtSeconds: number,
  ): void {
    const separation = this.computeSeparation(monster);
    const dirLength = Math.hypot(dirX, dirY);
    const normX = dirLength > 0 ? dirX / dirLength : 0;
    const normY = dirLength > 0 ? dirY / dirLength : 0;

    const dx = (normX * speed + separation.x * speed * SEPARATION_WEIGHT) * dtSeconds;
    const dy = (normY * speed + separation.y * speed * SEPARATION_WEIGHT) * dtSeconds;
    const monsterR = monsterRadius(monster);
    const crushes = monstersData[monster.type]?.crushesObstacles === true;

    const fullX = monster.x + dx;
    const fullY = monster.y + dy;
    if (!this.isBlockedForMonster(fullX, fullY, monsterR, crushes)) {
      monster.x = fullX;
      monster.y = fullY;
      monster.stuckSeconds = 0; // 완전히 자유로운 이동 — 확실히 안 막혔다
      return;
    }

    // 여기부터는 뭔가 막혀서 폴백(축 슬라이딩/접선 미끄러짐)이 필요한 상태다.
    // 폴백 중 하나가 "성공"해도 stuckSeconds를 0으로 리셋하지 않는다 — 장애물
    // 하나의 모서리를 도는 정상적인 우회는 보통 1초 안에 끝나 escape 임계값을
    // 넘기 전에 다시 완전히 자유로운 이동으로 돌아간다(위에서 리셋됨). 반면 여러
    // 장애물이 촘촘히 둘러싼 "주머니"에서는 매 틱 아주 조금씩만 미끄러지며 계속
    // 폴백에 의존하는 상태가 길게 이어질 수 있는데, 여기서 리셋해버리면 "뭔가는
    // 계속 움직이니 안 막힌 것"으로 잘못 판단해 탈출 로직이 영원히 발동하지
    // 않는다(docs/backend/42, 스트레스 테스트로 발견한 버그).
    monster.stuckSeconds += dtSeconds;

    // dx/dy가 정확히 0이면(장애물과 정확히 같은 x축 또는 y축으로 접근하는 흔한
    // 경우) 그 축만의 "이동"은 사실 제자리(현재 좌표 그대로)다 — 아무 데도 안
    // 움직였으면서 막힘 여부만 우연히 통과할 수 있어, 그 축이 실제로 변할 때만
    // (dx/dy != 0) 결과를 인정한다.
    if (dx !== 0 && !this.isBlockedForMonster(fullX, monster.y, monsterR, crushes)) {
      monster.x = fullX;
    } else if (dy !== 0 && !this.isBlockedForMonster(monster.x, fullY, monsterR, crushes)) {
      monster.y = fullY;
    } else {
      // X/Y 축 슬라이딩도 안 됐다 — 목표가 장애물 중심과 거의 같은 x 또는 y라
      // 두 축 다 원 안으로 다시 파고드는 경우다. 장애물 표면을 따라 접선 방향으로
      // 미끄러뜨린다.
      const obstacle = this.findNearestObstacleCenter(monster.x, monster.y, monsterR);
      if (obstacle) {
        const radialX = monster.x - obstacle.x;
        const radialY = monster.y - obstacle.y;
        const radialLength = Math.hypot(radialX, radialY);

        if (radialLength > 0) {
          // 반경 벡터에 수직인 두 접선 후보 중, 원래 가려던 방향(dx,dy)과 내적이
          // 더 큰 쪽(더 그 방향에 가까운 쪽)을 고른다.
          const tangentAX = -radialY / radialLength;
          const tangentAY = radialX / radialLength;
          const tangentBX = radialY / radialLength;
          const tangentBY = -radialX / radialLength;
          const useTangentA = tangentAX * dx + tangentAY * dy >= tangentBX * dx + tangentBY * dy;
          const tangentX = useTangentA ? tangentAX : tangentBX;
          const tangentY = useTangentA ? tangentAY : tangentBY;

          const stepLength = Math.hypot(dx, dy);
          const tangentFullX = monster.x + tangentX * stepLength;
          const tangentFullY = monster.y + tangentY * stepLength;
          if (!this.isBlockedForMonster(tangentFullX, tangentFullY, monsterR, crushes)) {
            monster.x = tangentFullX;
            monster.y = tangentFullY;
          }
        }
      }

      // 넷 다 막혔거나(자원 노드 여러 개에 완전히 둘러싸인 경우) 장애물 자체를
      // 못 찾은 극단적인 경우 — 아무것도 안 하고 아래 탈출 검사로 넘어간다.
    }

    if (monster.stuckSeconds >= STUCK_ESCAPE_SECONDS) {
      this.tryEscapeStuckMonster(monster, normX, normY, monsterR, crushes);
      monster.stuckSeconds = 0; // 성공하든 실패하든 다음 주기에 새 각도로 다시 시도
    }
  }

  /**
   * 완전히 막힌 몬스터를 "원래 가려던 방향"(목표를 향한 정규화 방향, `normX/normY`)
   * 쪽으로 우선 점프시켜 탈출을 시도한다.
   *
   * 처음엔 가장 가까운 장애물 **반대쪽**으로 점프했는데, 실제로 써 보니(스크린샷
   * 제보) 갇힌 지점에서 원래 가려던 목표(코어/플레이어)와 정반대 방향으로 튕겨
   * 나가는 경우가 많았다 — 장애물 하나를 기준으로 "그것만 피하면 된다"고 판단한
   * 것이지 "결국 어디로 가고 싶은지"는 전혀 고려하지 않았기 때문이다. 목표
   * 방향을 정면으로 두고 좌우로 부채꼴을 벌려가며(`STUCK_ESCAPE_ATTEMPTS`회,
   * 22.5도씩 번갈아 좌우로 확대) 처음 안 막힌 후보를 쓴다 — 목표에서 완전히
   * 등지는 방향보다 목표 쪽으로 최대한 붙은 우회를 먼저 시도해야, 탈출 직후에도
   * 계속 목표를 향해 나아갈 가능성이 높다.
   *
   * 매 틱 조금씩 후퇴시키는 대신 한 번에 장애물 키프아웃 반경보다 확실히 큰 거리
   * (`STUCK_ESCAPE_DISTANCE`)를 옮기는 이유: 점진적 이동은 "탈출 중" 상태(타이머/
   * 방향)를 따로 저장해야 해서 더 복잡한데, 실제로 갇히는 경우 대부분(노드 하나의
   * 고리에 막힌 경우)은 한 번의 점프로 충분히 벗어난다 — 드물게(1.5초에 1회)
   * 순간 이동처럼 보이는 것이 "영원히 멈춤" 또는 "목표 반대쪽으로 튕겨나감"보다
   * 훨씬 낫다는 판단이다. 부채꼴 검색 안에서 전부 막히면 이번 틱은 포기한다
   * (무한 재시도 방지 우선, `pickClusterNodePosition` 등 기존 패턴과 동일) —
   * 호출부가 `stuckSeconds`를 리셋하므로 다음 주기에 다시 시도된다.
   */
  private tryEscapeStuckMonster(
    monster: MonsterEntity,
    normX: number,
    normY: number,
    monsterR: number,
    crushes: boolean,
  ): void {
    // 목표 방향을 못 구하면(정지 상태 등) 그냥 원점 반대쪽 아무 방향이나 기준으로
    // 삼는다 — 이런 경우가 실제로는 거의 없지만 각도 자체를 정의 못 하는 사고를 막는다.
    const desiredAngle =
      normX !== 0 || normY !== 0 ? Math.atan2(normY, normX) : Math.atan2(monster.y, monster.x);

    const ANGLE_STEP = Math.PI / 8; // 22.5도
    for (let attempt = 0; attempt < STUCK_ESCAPE_ATTEMPTS; attempt += 1) {
      const side = attempt % 2 === 0 ? 1 : -1;
      const magnitude = Math.ceil(attempt / 2);
      const angle = desiredAngle + side * magnitude * ANGLE_STEP + (this.rng() - 0.5) * 0.1;
      const candidateX = monster.x + Math.cos(angle) * STUCK_ESCAPE_DISTANCE;
      const candidateY = monster.y + Math.sin(angle) * STUCK_ESCAPE_DISTANCE;
      if (!this.isBlockedForMonster(candidateX, candidateY, monsterR, crushes)) {
        monster.x = candidateX;
        monster.y = candidateY;
        return;
      }
    }
  }

  /**
   * 플레이어 좌표에서 투사체 생성 좌표(muzzleOffset만큼 떨어진 총구)까지의 구간에
   * 몬스터가 걸쳐 있었는지 검사한다. 원-원 판정이 아니라 원-선분 판정이 필요한 이유:
   * 몬스터가 정확히 그 구간 "중간"에 있으면 두 끝점(플레이어 좌표/총구 좌표) 중
   * 어느 쪽과도 안 겹칠 수 있다 — 구간에서 몬스터 중심에 가장 가까운 점을 구해서
   * 그 점과 겹치는지를 봐야 새는 경우가 없다. 걸쳐 있었으면 그 몬스터에게 즉시
   * 데미지를 주고 true를 반환한다(투사체는 아예 만들지 않는다 — 총구가 생겨나기도
   * 전에 이미 막고 있었으니 "총구에서 발사되어 날아가는" 연출 자체가 성립하지 않는다).
   */
  private resolveMuzzleGapHit(player: PlayerEntity, projectile: ProjectileEntity): boolean {
    const gapX = projectile.x - player.x;
    const gapY = projectile.y - player.y;
    const gapLength = Math.hypot(gapX, gapY);
    if (gapLength <= 0) return false;

    const dirX = gapX / gapLength;
    const dirY = gapY / gapLength;

    let closestId: string | undefined;
    let closestAlong = Infinity;
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45). 세그먼트(플레이어→총구) 위의
    // 어느 점이든 플레이어로부터 gapLength 이내이므로, 플레이어 중심 반경
    // gapLength + 몬스터 최대 히트박스로 질의하면 세그먼트 전체를 안전하게 덮는다.
    // 이 함수는 "가장 가까운" 후보를 직접 비교해서 고르므로(첫 매치 반환이 아님)
    // 후보 순서와 무관하게 결과가 같다.
    const candidateIds = this.monsterGrid.queryRadius(
      player.x,
      player.y,
      gapLength + MAX_MONSTER_HIT_RADIUS,
    );
    for (const id of candidateIds) {
      const monster = this.monsters.get(id);
      if (!monster) continue;
      const hitRadius = monsterRadius(monster);
      const alongRaw = (monster.x - player.x) * dirX + (monster.y - player.y) * dirY;
      const along = Math.max(0, Math.min(gapLength, alongRaw));
      const closestX = player.x + dirX * along;
      const closestY = player.y + dirY * along;
      if (!circlesOverlap(closestX, closestY, monster.x, monster.y, hitRadius)) continue;
      if (along >= closestAlong) continue;
      closestId = id;
      closestAlong = along;
    }

    if (!closestId) return false;
    const monster = this.monsters.get(closestId)!;
    this.damageMonster(closestId, monster.hp - projectile.damage);
    return true;
  }

  private applyMeleeHit(hit: MeleeHit): void {
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45) — 부채꼴의 최대 반경(range)에
    // 몬스터 최대 히트박스를 더해 후보를 안전하게 잡는다. 이 함수는 부채꼴 안의
    // 몬스터 전부에게 피해를 주므로(첫 매치에서 멈추지 않음) 후보 순서는 결과에
    // 영향을 주지 않는다.
    const candidateIds = this.monsterGrid.queryRadius(
      hit.originX,
      hit.originY,
      hit.range + MAX_MONSTER_HIT_RADIUS,
    );
    for (const id of candidateIds) {
      const monster = this.monsters.get(id);
      if (!monster) continue;
      if (withinMeleeArc(hit, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(id, monster.hp - hit.damage);
      }
    }
  }

  /**
   * 투사체 충돌 처리. 몬스터 판정을 먼저 하고, 못 맞혔으면 정적 장애물(건축물/자원
   * 노드/콜로니/코어) 판정으로 넘어간다. 건축물은 `blocksProjectile`인 타입(벽)만
   * 막는다(울타리는 통과시킨다, docs/backend/18 §1) — 자원 노드/콜로니/코어는
   * 타입 구분 없이 전부 막는다(docs/backend/38, 사용자가 넷 다 막아달라고 명시).
   * 어느 쪽이든 맞으면 투사체만 사라지고 대상은 피해를 입지 않는다(건축물은 몬스터
   * 공격으로만, 자원/콜로니/코어는 아예 파괴 불가로 설계됐다).
   */
  private resolveProjectileHits(): void {
    for (const [projectileId, projectile] of this.projectiles) {
      if (this.projectileHitsMonster(projectileId, projectile)) continue;
      this.projectileHitsObstacle(projectileId, projectile);
    }
  }

  private projectileHitsMonster(projectileId: string, projectile: ProjectileEntity): boolean {
    // 전체 몬스터 대신 격자 후보만 본다(docs/backend/45) — 후보 반경에 몬스터 최대
    // 히트박스를 더해야, 큰(보스급) 몬스터의 중심이 격자 반경 밖이어도 몸이 걸치는
    // 경우를 놓치지 않는다.
    const candidateIds = this.monsterGrid.queryRadius(
      projectile.x,
      projectile.y,
      MAX_MONSTER_HIT_RADIUS,
    );
    for (const monsterId of candidateIds) {
      const monster = this.monsters.get(monsterId);
      if (!monster) continue;
      if (circlesOverlap(projectile.x, projectile.y, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(monsterId, monster.hp - projectile.damage);
        this.projectiles.delete(projectileId);
        return true;
      }
    }
    return false;
  }

  private projectileHitsObstacle(projectileId: string, projectile: ProjectileEntity): void {
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksProjectile) continue;
      if (circlesOverlap(projectile.x, projectile.y, building.x, building.y, TILE_SIZE / 2)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    for (const node of this.resourceNodes.values()) {
      if (node.hp <= 0) continue; // 고갈된 자리는 투사체도 그냥 통과한다(docs/backend/39)
      if (circlesOverlap(projectile.x, projectile.y, node.x, node.y, resourcesData[node.type].hitRadius)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    for (const colony of this.colonies.values()) {
      if (circlesOverlap(projectile.x, projectile.y, colony.x, colony.y, COLONY_RADIUS)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
    // 투사체는 점으로 취급한다 — 발자국 안에 들어오면 코어가 막은 것이다.
    if (coreDistance(projectile.x, projectile.y) <= 0) {
      this.projectiles.delete(projectileId);
    }
  }

  /**
   * 처치 보상은 죽은 자리에 떨어지므로 "누가 죽였는지"를 받지 않는다 — 투사체가
   * 날아가는 동안 쏜 사람이 나가도 보상이 사라지지 않는다.
   */
  private damageMonster(id: string, remainingHp: number): void {
    if (remainingHp <= 0) {
      const monster = this.monsters.get(id);
      this.monsters.delete(id);
      this.monsterGrid.remove(id);
      if (monster) {
        // 수호대였다면 소속 콜로니 장부에서 지운다 — 저장분은 복원되지 않는다
        // (죽은 몬스터는 영구히 줄어드는 게 정화로 가는 길이다).
        if (monster.homeColonyId) this.colonies.get(monster.homeColonyId)?.guardIds.delete(id);
        this.grantMonsterDrop(monster);
      }
      return;
    }
    const monster = this.monsters.get(id);
    if (monster) monster.hp = remainingHp;
  }

  /**
   * 처치 보상 지급. 몬스터 타입 데이터에 `energyDrop`이 있으면(보스) 팀 공유분으로
   * 즉시 지급하고 거기서 끝난다. 그 외 몬스터는 `itemDrops` 표를 굴려 죽은 자리에
   * **바닥 드롭**을 남긴다 — 드랍은 부품/희귀부품 두 종류뿐이고, 쓸 데는 상점 판매다.
   *
   * 누가 죽였는지(killerId)는 필요 없다 — 바닥에 떨어뜨리므로 먼저 줍는 사람이 임자다.
   * 막타를 누가 쳤는지로 보상이 갈리지 않는 편이 협동에 맞는다.
   *
   * 잡은 사람 인벤토리에 바로 넣지 않는 이유: 가방이 꽉 차면 보상이 조용히 증발한다.
   * 나무/돌과 똑같이 바닥에 떨어뜨리면 못 주운 몫이 눈에 보이고, 전투 중엔 흘리고
   * 나중에 회수하는 선택도 생긴다.
   */
  private grantMonsterDrop(monster: MonsterEntity): void {
    const data = monstersData[monster.type];

    // 에너지와 바닥 드랍은 배타가 아니다 — 보스/엘리트는 팀 에너지도 주고 부품도
    // 떨군다(예전엔 에너지가 있으면 드랍을 건너뛰었는데, 보스 레이드를 잡았는데
    // 바닥에 아무것도 안 떨어지는 건 보상 체감이 밋밋했다).
    if (data.energyDrop) {
      this.core.sharedEnergy += this.rollDropRange(data.energyDrop);
    }

    // 드랍 테이블은 항목마다 독립 판정이다 — 한 마리가 부품과 희귀부품을 함께 줄 수 있다.
    for (const entry of data.itemDrops ?? []) {
      if (this.rng() >= entry.chance) continue;
      this.dropItem(entry.itemId, this.rollDropRange(entry), monster.x, monster.y);
    }
  }

  /** [min, max] 정수 범위(양끝 포함)에서 하나를 뽑는다. World의 rng를 재사용해 테스트에서 결정론적으로 검증할 수 있게 한다. */
  private rollDropRange(range: DropRange): number {
    if (range.max <= range.min) return range.min;
    return range.min + Math.floor(this.rng() * (range.max - range.min + 1));
  }
}

/** 클라이언트에 그대로 실어 보낼 수 있는 평평한(flat) 예고 정보. Colyseus 스키마는 유니온 타입을 못 다루므로, `BossPatternState`를 여기서 하나의 형태로 눌러 편다. */
export interface BossTelegraph {
  kind: 'charge' | 'slam';
  x: number;
  y: number;
  /** 돌진 방향(단위 벡터). 광역 패턴에서는 안 쓴다(0). */
  dirX: number;
  dirY: number;
  /** 돌진: 경로 폭의 절반. 광역: 범위 반경. */
  radius: number;
  /** 돌진: 예고 종료 시 실제로 도달할 거리(speed * duration). 광역에서는 0. */
  range: number;
  remaining: number;
  total: number;
}

/**
 * 몬스터의 현재 보스 패턴 상태를 서버/로컬 커넥션이 동기화 스냅샷에 그대로 실을 수
 * 있는 형태로 변환한다. 예고(Telegraph) 상태가 아니면(idle/charging/일반 몹) undefined —
 * 돌진이 실제로 실행되는 동안에는 보스가 빠르게 움직이는 모습 자체가 "이미 벌어진 일"을
 * 보여주므로 별도의 경고 표시가 필요 없다. 서버(GameRoom)와 로컬(LocalConnection) 양쪽이
 * 이 함수를 그대로 재사용해서, 두 경로가 서로 다른 방식으로 값을 계산해 어긋날 여지를 없앤다.
 */
export function describeBossTelegraph(
  monster: MonsterEntity,
  data: MonsterData,
): BossTelegraph | undefined {
  const pattern = monster.pattern;

  if (pattern.kind === 'chargeTelegraph') {
    const charge = data.chargeAttack;
    if (!charge) return undefined;
    return {
      kind: 'charge',
      x: monster.x,
      y: monster.y,
      dirX: pattern.dirX,
      dirY: pattern.dirY,
      radius: charge.width / 2,
      range: charge.speed * charge.duration,
      remaining: Math.max(0, pattern.timer),
      total: pattern.total,
    };
  }

  if (pattern.kind === 'slamTelegraph') {
    const slam = data.slamAttack;
    if (!slam) return undefined;
    return {
      kind: 'slam',
      x: pattern.x,
      y: pattern.y,
      dirX: 0,
      dirY: 0,
      radius: slam.radius,
      range: 0,
      remaining: Math.max(0, pattern.timer),
      total: pattern.total,
    };
  }

  return undefined;
}
