import { MAP_ORIGIN, MAP_SIZE_TILES, TILE_SIZE, cellCenterWorld, worldToCell } from '../constants';
import {
  buildingsData,
  coloniesData,
  coreUpgradesData,
  loadoutData,
  monstersData,
  resourcesData,
  wavesData,
  type BuildingType,
  type DropRange,
  type MonsterData,
  type MonsterType,
  type ResourceType,
} from '../data';
import type { PlayerInputMessage } from '../protocol/messages';
import { FlowField, type FlowFieldGrid } from './ai/flowField';
import { BuildingRegistry, type BuildingEntity } from './building';
import { COLONY_RADIUS, ColonyRegistry, colonyStageFor, type ColonyEntity } from './colony';
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
import { normalizeMoveVector, stepPosition } from './movement';
import { WaveManager, type GamePhase } from './wave';

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
/** 코어 자체의 판정 반경(px). 몬스터의 attackRange에 더해져 "코어에 도달했다"를 정의한다. */
const CORE_RADIUS = TILE_SIZE;
/** 코어 옆에서 자원을 입고(E)할 수 있는 반경(px). CORE_RADIUS보다 넉넉히 둬서 코어 바로 앞이 아니어도 상호작용할 수 있게 한다. */
const CORE_INTERACT_RADIUS = CORE_RADIUS + 32;
/** 콜로니 채널링(파괴 작업)을 시작할 수 있는 반경(px). CORE_INTERACT_RADIUS와 같은 값 — 둘 다 "구조물 바로 옆" 상호작용이다. */
const COLONY_CHANNEL_RADIUS = CORE_INTERACT_RADIUS;
/** 이 거리보다 가까운 몬스터끼리는 서로 밀어낸다 — 군집 분리(기술명세 §5.3). */
const SEPARATION_RADIUS = HIT_RADIUS * 2.5;
/** 분리력이 주 이동 방향을 완전히 덮어쓰지 않도록 두는 가중치. */
const SEPARATION_WEIGHT = 0.6;
/** 한 번 잡은 어그로 타겟은 아그로 반경의 이 배수를 벗어나기 전까진 유지한다(타겟 떨림 방지). */
const AGGRO_LEASH_MULTIPLIER = 1.5;
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
export const PLAYER_CORE_COLLISION_RADIUS = HIT_RADIUS + CORE_RADIUS;
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
  wood: number;
  stone: number;
  /** 흔한 몬스터(잡몹/돌진/탱커) 처치로 받는 휴대 자원. 나무/돌과 동일하게 코어에
   * 입고(E)해야 팀 공유(coreSharedScrap)가 된다. */
  scrap: number;
  /** 퀵슬롯. 장착 무기도 여기서 나온다 — 클라이언트가 무기를 주장할 수 없다. */
  inventory: Inventory;
  /** 지금 채널링(콜로니 파괴 작업) 중인 콜로니 id. 채널링 중이 아니면 undefined. */
  channelingColonyId?: string;
  /** 채널링 진행률(0~1). 이동/피격/사거리 이탈로 언제든 0으로 리셋될 수 있다. */
  channelProgress: number;
  /** 이번 틱에 몬스터에게 맞았는지. 매 틱 시작 시 초기화되고, damagePlayer()가 세팅한다.
   * 채널링 "피격 시 중단" 판정에 쓴다 — tickChannels()가 tickMonsters() 이후에 읽는다. */
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
  | { kind: 'slamTelegraph'; timer: number; total: number; x: number; y: number };

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
  sharedWood: number;
  sharedStone: number;
  /** 흔한 몬스터 처치 보상(scrap)이 코어 입고(E)로 쌓이는 팀 공유분. 나무/돌과 동일한 흐름. */
  sharedScrap: number;
  /**
   * 콜로니 파괴 또는 보스 처치로만 얻는 희귀 자원. 나무/돌/scrap과 달리 "채집 후 입고"
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
}

let nextMonsterId = 1;
let nextResourceNodeId = 1;
let nextBuildingId = 1;

export interface WorldOptions {
  /** 자원 노드 군집 배치에 쓰는 RNG. 테스트에서 결정론적으로 검증하려고 주입한다(wave.ts와 동일 패턴). */
  rng?: () => number;
}

export class World {
  private players = new Map<string, PlayerEntity>();
  private inputs = new Map<string, PlayerInputMessage>();
  private monsters = new Map<string, MonsterEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private readonly cooldowns = new WeaponCooldowns();
  private readonly waveManager = new WaveManager();
  private readonly buildings = new BuildingRegistry();
  private readonly resourceNodes = new Map<string, ResourceNodeEntity>();
  private readonly colonies = new ColonyRegistry();
  /**
   * 콜로니가 차지한 그리드 셀("cx,cy" 키) 집합. 콜로니는 배치된 후 위치가 절대
   * 바뀌지 않으므로(파괴돼도 폐허로 그 자리에 남는다, colony.ts) `BuildingRegistry`
   * 같은 동적 인덱스 없이 **`startColonies()` 호출 시점에 한 번만 계산해서 캐싱**한다
   * — FlowField의 `isBlocked` 콜백이 여기 기록된 셀도 같이 막힌 것으로 본다
   * (§markColonyObstacleCell). `World` 생성 시점엔 콜로니가 아직 없어 비어 있다.
   *
   * 코어 자신의 셀은 절대 여기 넣지 않는다 — FlowField의 목표(target) 셀이 막히면
   * `recompute()`가 전체 계산을 포기해버린다(치명적). 몬스터는 어차피
   * `attackRange + CORE_RADIUS`에서 멈춰 코어를 공격하므로 코어 셀까지 들어갈
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
    sharedWood: 0,
    sharedStone: 0,
    sharedScrap: 0,
    sharedEnergy: 0,
    tier: 0,
  };
  private elapsedSeconds = 0;
  /** 이번 낮 페이즈에 스킵 투표를 던진 플레이어 id 집합. 만장일치면 skipDay()를 부른다. */
  private skipVotes = new Set<string>();

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
    for (const colony of this.colonies.values()) this.markColonyObstacleCell(colony.x, colony.y);
    this.recomputeFlowField();
  }

  /** 콜로니처럼 위치가 절대 바뀌지 않는 장애물의 셀을 FlowField 차단 집합에 등록한다. */
  private markColonyObstacleCell(x: number, y: number): void {
    const { cx, cy } = worldToCell(x, y);
    this.colonyObstacleCells.add(`${cx},${cy}`);
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
    for (const entry of loadoutData.starting) inventory.add(entry.itemId, entry.count);

    this.players.set(id, {
      id,
      x,
      y,
      aimAngle: 0,
      lastProcessedSeq: 0,
      hp: wavesData.playerHp,
      wood: 0,
      stone: 0,
      scrap: 0,
      inventory,
      channelProgress: 0,
      tookDamageThisTick: false,
    });
  }

  removePlayer(id: string): void {
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
      !isFiniteNumber(input.aimAngle) ||
      // channeling은 옵셔널이다 — 없으면(구버전 호출부/테스트) false로 취급하고
      // 입력 전체를 거절하지 않는다. 있는데 boolean이 아니면 거절한다.
      (input.channeling !== undefined && typeof input.channeling !== 'boolean')
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
      channeling: input.channeling === true,
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

    // 체력이 가득이면 소모하지 않는다. 먼저 확인하지 않으면 붕대만 날린다.
    if (player.hp >= wavesData.playerHp) return;

    const item = player.inventory.consumeSelected();
    if (!item?.healAmount) return;

    player.hp = Math.min(wavesData.playerHp, player.hp + item.healAmount);
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
    // 채널링 중엔 공격할 수 없다 — "무방비 상태"를 실제로 강제한다(콜로니 채널링은
    // 엄호가 필요한 협동 압박 요소로 설계됐다, docs/backend/35).
    if (player.channelingColonyId) return;

    const weaponId = player.inventory.equippedWeaponId;
    // 무기가 아닌 슬롯(붕대 등)을 들고 있으면 공격이 성립하지 않는다.
    if (!weaponId) return;
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
      if (data.requiredTool !== weaponId) continue;
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

    // ResourceType이 늘어나면(현재 wood/stone 2종) 여기에 분기를 추가해야 한다 —
    // PlayerEntity가 자원별 전용 필드를 쓰는 설계라(범용 인벤토리 맵이 아니다) 자동으로
    // 확장되지 않는다.
    if (target.type === 'wood') player.wood += data.yieldOnDeplete;
    else if (target.type === 'stone') player.stone += data.yieldOnDeplete;
  }

  /**
   * 코어 입고 요청(E). 플레이어가 들고 있는(=아직 입고하지 않은) 나무/돌/scrap을
   * 코어의 공유 창고로 옮긴다 — 코어 반경 안에서만 되고, 들고 있는 게 하나도 없으면
   * 조용히 무시한다. 입고 즉시 개인 지갑은 0이 된다(다시 모아야 다음 몫이 생긴다).
   */
  depositAtCore(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.wood <= 0 && player.stone <= 0 && player.scrap <= 0) return;

    const distance = Math.hypot(player.x, player.y); // 코어는 항상 원점(0,0)
    if (distance > CORE_INTERACT_RADIUS) return;

    this.core.sharedWood += player.wood;
    this.core.sharedStone += player.stone;
    this.core.sharedScrap += player.scrap;
    player.wood = 0;
    player.stone = 0;
    player.scrap = 0;
  }

  /**
   * 코어 업그레이드 요청. `core.tier`번째(0-based) 단계를 팀 공유 에너지로 산다 —
   * 코어 체력(즉시 회복 + 최대치 증가)·건설 가능 반경·제작/스텟증가 해금이 전부
   * 한 번에 적용된다(docs/backend/38). 마지막 단계까지 다 샀거나 에너지가
   * 부족하면 조용히 무시한다.
   */
  upgradeCore(playerId: string): void {
    if (!this.players.has(playerId)) return;

    const tier = coreUpgradesData.tiers[this.core.tier];
    if (!tier) return; // 이미 최고 단계
    if (this.core.sharedEnergy < tier.cost) return;

    this.core.sharedEnergy -= tier.cost;
    this.core.tier += 1;
    this.core.maxHp += tier.coreHpBonus;
    this.core.hp += tier.coreHpBonus;
  }

  /** 코어 원점 기준 건설 가능 반경(px). 구매한 단계만큼 baseBuildRadius에 누적된다. */
  getBuildRadius(): number {
    let radius = coreUpgradesData.baseBuildRadius;
    for (let i = 0; i < this.core.tier; i += 1) {
      radius += coreUpgradesData.tiers[i]?.buildRadiusBonus ?? 0;
    }
    return radius;
  }

  /** 현재 단계 이하 어떤 단계에서든 제작이 해금됐으면 true(한 번 해금되면 계속 유지). */
  isCraftingUnlocked(): boolean {
    return coreUpgradesData.tiers.slice(0, this.core.tier).some((tier) => tier.unlocksCrafting);
  }

  /** 플레이어 스텟 증가 시스템 해금 여부. 아직 그걸 실제로 쓸 UI/구매 로직은 없다 — 플래그만. */
  isStatUpgradesUnlocked(): boolean {
    return coreUpgradesData.tiers
      .slice(0, this.core.tier)
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
    // 코어 업그레이드로 건설 가능 반경이 늘어난다(docs/backend/38) — 반경 밖은 아직 못 짓는다.
    if (Math.hypot(x, y) > this.getBuildRadius()) return;

    const coreCell = worldToCell(0, 0);
    if (cx === coreCell.cx && cy === coreCell.cy) return;

    for (const node of this.resourceNodes.values()) {
      const nodeCell = worldToCell(node.x, node.y);
      if (nodeCell.cx === cx && nodeCell.cy === cy) return;
    }

    for (const other of this.players.values()) {
      const otherCell = worldToCell(other.x, other.y);
      if (otherCell.cx === cx && otherCell.cy === cy) return;
    }

    if (!this.players.has(playerId)) return;
    if (this.core.sharedWood < data.woodCost || this.core.sharedStone < data.stoneCost) return;

    this.core.sharedWood -= data.woodCost;
    this.core.sharedStone -= data.stoneCost;

    const id = `building_${nextBuildingId++}`;
    this.buildings.place(id, buildingType as BuildingType, cx, cy, x, y);
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
    }
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
      () => this.monsters.size,
      (type, x, y) => this.addMonster(type, x, y),
    );
    // 밤이 끝나고 새 낮이 시작되는 시점(웨이브 클리어) — 다운된 플레이어를 부활시키고
    // 지난 낮의 스킵 투표를 초기화한다(docs/backend/11 §4.1).
    if (previousPhase !== 'day' && this.waveManager.currentPhase === 'day') {
      this.revivePlayers();
      this.skipVotes.clear();
    }

    this.tickMonsters(dtSeconds);
    this.tickResourceNodes(dtSeconds);
    // tickMonsters() 다음에 불러야 한다 — 이번 틱의 피격(tookDamageThisTick)이
    // 이미 반영된 뒤여야 "피격 시 채널 중단"이 정확히 판정된다.
    this.tickChannels(dtSeconds);
    // tickChannels() 다음에 불러야 한다 — 이번 틱에 새로 채널링이 시작된 콜로니도
    // 한 틱 지연 없이 바로 스폰이 멈춰야 한다(§tickColonies의 채널링 중 스폰 정지).
    this.tickColonies(dtSeconds);

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

  private addMonster(type: MonsterType, x: number, y: number): void {
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
      specialAttackCooldown: data.chargeAttack || data.slamAttack ? BOSS_FIRST_PATTERN_DELAY : 0,
    });
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
   * 살아있는 콜로니마다 스폰 타이머를 감소시키고, 0이 되면 몬스터를 하나 추가한다.
   * `tickMonsters()`처럼 페이즈(낮/밤) 무관하게 매 틱 그냥 돈다 — 콜로니가 낮에도
   * 몬스터를 내보내는 게 이 기능의 핵심이라, 애초에 페이즈로 막을 이유가 없다
   * (몬스터 자체는 addMonster()로 추가되는 순간부터 tickMonsters()가 똑같이
   * 다루므로, 낮/밤에 따라 AI가 달라지지 않는다).
   *
   * 스테이지(난이도 구간)는 현재 웨이브 진행도(WaveManager.currentWave) 기준으로
   * 콜로니 전체가 공유한다 — "시간이 지날수록 강해진다"를 밤 웨이브와 같은 축으로
   * 표현한다(§colonyStageFor).
   *
   * **채널링 중인 콜로니는 스폰이 완전히 멈춘다.** 누군가 파괴 작업 중인 콜로니가
   * 그 와중에도 계속 몬스터를 뱉으면 엄호하는 인원이 오히려 더 불리해지기만 하고,
   * "채널링 = 그 콜로니를 무력화하기 시작했다"는 의미도 흐려진다. 스폰 타이머
   * 자체를 얼려서(감소시키지 않음) 멈추는 이유: 그냥 스폰만 건너뛰고 타이머는
   * 계속 줄이면, 채널링이 중간에 끊겼을 때 밀린 스폰이 한꺼번에(또는 다음 틱에
   * 바로) 터져나오는 부자연스러운 결과가 된다.
   */
  private tickColonies(dtSeconds: number): void {
    const stage = colonyStageFor(this.waveManager.currentWave);

    for (const colony of this.colonies.values()) {
      if (colony.destroyed) continue;
      if (this.isColonyBeingChanneled(colony.id)) continue;

      colony.spawnTimer -= dtSeconds;
      if (colony.spawnTimer > 0) continue;

      colony.spawnTimer = stage.spawnIntervalSeconds;
      const type = stage.types[Math.floor(this.rng() * stage.types.length)] as MonsterType;

      // 콜로니 중심 좌표 그대로 스폰시키면(예전 방식) 콜로니 자신의 하드 충돌
      // 반경(docs/backend/38) 안에서 태어나는 셈이라, moveMonster의 장애물 회피가
      // "이미 겹친 상태"를 벗어날 방법이 없어 그 자리에 영구히 끼어버린다
      // (docs/backend/40). 콜로니 경계 바로 바깥, 무작위 각도의 지점에 스폰시켜서
      // 처음부터 안 겹치게 한다.
      const spawnMonsterR = monstersData[type]?.hitRadius ?? HIT_RADIUS;
      const angle = this.rng() * Math.PI * 2;
      const offset = COLONY_RADIUS + spawnMonsterR + 2; // 여유 2px — 겹침 없이 확실히 밖
      this.addMonster(type, colony.x + Math.cos(angle) * offset, colony.y + Math.sin(angle) * offset);
    }
  }

  /** 이번 틱 기준으로 이 콜로니를 채널링 중인 플레이어가 있는지. */
  private isColonyBeingChanneled(colonyId: string): boolean {
    for (const player of this.players.values()) {
      if (player.channelingColonyId === colonyId) return true;
    }
    return false;
  }

  /**
   * 콜로니 채널링(파괴 작업) 진행을 처리한다. `tickMonsters()` 이후에 불러야 한다
   * — 이번 틱에 몬스터에게 맞았는지(`tookDamageThisTick`)가 이미 반영된 뒤여야
   * "피격 시 중단"이 정확히 판정된다.
   *
   * 조건(이동 없음 + 피격 없음 + 파괴 안 된 콜로니 사거리 안 + 채널 키 유지)이
   * 하나라도 깨지면 그 자리에서 진행률을 0으로 되돌린다 — 부분 진행을 이어서
   * 채우는 게 아니라 매번 처음부터 다시 시작해야 한다(이게 "엄호"를 실제로
   * 필요하게 만드는 핵심 규칙, docs/backend/35).
   */
  private tickChannels(dtSeconds: number): void {
    for (const [playerId, player] of this.players) {
      const input = this.inputs.get(playerId);
      const wantsChannel = input?.channeling === true && input.moveX === 0 && input.moveY === 0;
      const target = wantsChannel && player.hp > 0 ? this.findChannelableColony(player) : undefined;

      if (!target || player.tookDamageThisTick) {
        player.channelingColonyId = undefined;
        player.channelProgress = 0;
        continue;
      }

      // 채널 대상이 바뀌면(다른 콜로니로 옮겨감) 진행률을 새로 시작한다.
      if (player.channelingColonyId !== target.id) {
        player.channelingColonyId = target.id;
        player.channelProgress = 0;
      }

      player.channelProgress += dtSeconds / coloniesData.channelSeconds;
      if (player.channelProgress < 1) continue;

      this.colonies.destroy(target.id);
      this.core.sharedEnergy += coloniesData.essenceReward;
      player.channelingColonyId = undefined;
      player.channelProgress = 0;
    }
  }

  /** 파괴되지 않은 콜로니 중 채널링 사거리(COLONY_CHANNEL_RADIUS) 안에 있는 것을 찾는다. */
  private findChannelableColony(player: PlayerEntity): ColonyEntity | undefined {
    for (const colony of this.colonies.values()) {
      if (colony.destroyed) continue;
      if (circlesOverlap(player.x, player.y, colony.x, colony.y, COLONY_CHANNEL_RADIUS)) {
        return colony;
      }
    }
    return undefined;
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
    for (const monster of this.monsters.values()) {
      const data = monstersData[monster.type];
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dtSeconds);

      // 보스 특수 패턴이 이번 틱의 이동/공격을 전부 처리했으면(예고 중이라 멈춰 있거나
      // 돌진 중이거나) 아래 일반 추격/이동 로직은 건너뛴다. chargeAttack/slamAttack이
      // 없는 타입(잡몹 등)은 매 틱 이 검사 하나만 거치고 바로 false를 반환한다.
      if (this.tickBossPattern(monster, data, dtSeconds)) continue;

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

      if (distanceToCore <= data.attackRange + CORE_RADIUS) {
        if (distanceToCore > 0) {
          monster.facingX = -monster.x / distanceToCore;
          monster.facingY = -monster.y / distanceToCore;
        }
        if (monster.attackCooldown <= 0) {
          this.core.hp = Math.max(0, this.core.hp - data.damage);
          monster.attackCooldown = data.attackInterval;
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
    if (!data.chargeAttack && !data.slamAttack) return false;

    switch (monster.pattern.kind) {
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

    const canCharge = !!data.chargeAttack;
    const canSlam = !!data.slamAttack;
    // 둘 다 가능하면 매번 무작위로 고른다 — 항상 같은 순서로만 나오면 패턴이 아니라
    // 그냥 다음 공격을 외우는 게 돼버린다.
    const useCharge = canCharge && (!canSlam || this.rng() < 0.5);

    const dx = target.x - monster.x;
    const dy = target.y - monster.y;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0 ? dx / distance : monster.facingX;
    const dirY = distance > 0 ? dy / distance : monster.facingY;
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
    if (circlesOverlap(x, y, 0, 0, PLAYER_CORE_COLLISION_RADIUS)) return true;
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
  private isBlockedForMonster(x: number, y: number, monsterR: number): boolean {
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
  private computeSeparation(monster: MonsterEntity): { x: number; y: number } {
    let x = 0;
    let y = 0;

    for (const other of this.monsters.values()) {
      if (other.id === monster.id) continue;
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
    const separation = this.computeSeparation(monster);
    const dirLength = Math.hypot(dirX, dirY);
    const normX = dirLength > 0 ? dirX / dirLength : 0;
    const normY = dirLength > 0 ? dirY / dirLength : 0;

    const dx = (normX * speed + separation.x * speed * SEPARATION_WEIGHT) * dtSeconds;
    const dy = (normY * speed + separation.y * speed * SEPARATION_WEIGHT) * dtSeconds;
    const monsterR = monsterRadius(monster);

    const fullX = monster.x + dx;
    const fullY = monster.y + dy;
    if (!this.isBlockedForMonster(fullX, fullY, monsterR)) {
      monster.x = fullX;
      monster.y = fullY;
      return;
    }

    if (!this.isBlockedForMonster(fullX, monster.y, monsterR)) {
      monster.x = fullX;
      return;
    }

    if (!this.isBlockedForMonster(monster.x, fullY, monsterR)) {
      monster.y = fullY;
      return;
    }

    // X/Y 축 슬라이딩도 안 됐다 — 목표가 장애물 중심과 거의 같은 x 또는 y라
    // 두 축 다 원 안으로 다시 파고드는 경우다. 장애물 표면을 따라 접선 방향으로
    // 미끄러뜨린다.
    const obstacle = this.findNearestObstacleCenter(monster.x, monster.y, monsterR);
    if (!obstacle) return; // 여기 도달했다는 건 뭔가 막았다는 뜻이라 원래 없을 케이스

    const radialX = monster.x - obstacle.x;
    const radialY = monster.y - obstacle.y;
    const radialLength = Math.hypot(radialX, radialY);
    if (radialLength === 0) return; // 장애물 중심과 완전히 겹친 극단적 경우 — 방향 정의 불가

    // 반경 벡터에 수직인 두 접선 후보 중, 원래 가려던 방향(dx,dy)과 내적이 더 큰
    // 쪽(더 그 방향에 가까운 쪽)을 고른다.
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
    if (!this.isBlockedForMonster(tangentFullX, tangentFullY, monsterR)) {
      monster.x = tangentFullX;
      monster.y = tangentFullY;
    }
    // 그래도 막히면(자원 노드 여러 개에 완전히 둘러싸인 극단적인 경우) 이 틱은
    // 움직이지 않는다 — movePlayer도 축 슬라이딩 단계에서 같은 한계를 받아들이고
    // 있어 일관적이다.
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
    for (const [id, monster] of this.monsters) {
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
    this.damageMonster(closestId, monster.hp - projectile.damage, player.id);
    return true;
  }

  private applyMeleeHit(hit: MeleeHit): void {
    for (const [id, monster] of this.monsters) {
      if (withinMeleeArc(hit, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(id, monster.hp - hit.damage, hit.ownerId);
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
    for (const [monsterId, monster] of this.monsters) {
      if (circlesOverlap(projectile.x, projectile.y, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(monsterId, monster.hp - projectile.damage, projectile.ownerId);
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
    if (circlesOverlap(projectile.x, projectile.y, 0, 0, CORE_RADIUS)) {
      this.projectiles.delete(projectileId);
    }
  }

  /**
   * `killerId`는 처치 보상을 누구에게 줄지 판정하는 데만 쓴다 — 없거나 이미 퇴장한
   * 플레이어면(투사체가 날아가는 동안 쏜 사람이 나간 경우 등) 흔한 자원(scrap) 보상만
   * 조용히 사라진다(팀 공유 보상인 energy는 killerId 없이도 그대로 지급된다).
   */
  private damageMonster(id: string, remainingHp: number, killerId?: string): void {
    if (remainingHp <= 0) {
      const monster = this.monsters.get(id);
      this.monsters.delete(id);
      if (monster) this.grantMonsterDrop(monster, killerId);
      return;
    }
    const monster = this.monsters.get(id);
    if (monster) monster.hp = remainingHp;
  }

  /**
   * 처치 보상 지급. 몬스터 타입 데이터에 `energyDrop`이 있으면(보스) 팀 공유 창고로
   * 즉시 지급하고, `scrapDrop`이 있으면(흔한 몬스터) 잡은 플레이어의 휴대 자원에
   * 지급한다 — 둘은 같은 몬스터 타입에 동시에 정의하지 않는 서로 다른 등급의 보상이다
   * (docs/backend 참고). 어느 쪽 필드도 없으면(설정 안 된 타입) 아무것도 지급하지 않는다.
   */
  private grantMonsterDrop(monster: MonsterEntity, killerId: string | undefined): void {
    const data = monstersData[monster.type];

    if (data.energyDrop) {
      this.core.sharedEnergy += this.rollDropRange(data.energyDrop);
      return;
    }

    if (data.scrapDrop && killerId) {
      const player = this.players.get(killerId);
      if (player) player.scrap += this.rollDropRange(data.scrapDrop);
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
