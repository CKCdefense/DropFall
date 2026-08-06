import { MAP_ORIGIN, MAP_SIZE_TILES, TILE_SIZE, cellCenterWorld, worldToCell } from '../constants';
import {
  buildingsData,
  loadoutData,
  monstersData,
  resourcesData,
  wavesData,
  type BuildingType,
  type MonsterData,
  type MonsterType,
  type ResourceType,
} from '../data';
import type { PlayerInputMessage } from '../protocol/messages';
import { FlowField, type FlowFieldGrid } from './ai/flowField';
import { BuildingRegistry, type BuildingEntity } from './building';
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
 * 크지만(MAP_SIZE_TILES 기준 코어에서 최대 1024px), 그 전체를 다 쓰면 자원이 몬스터
 * 스폰 반경(wavesData.spawnRadius=300)보다도 훨씬 멀리 나올 수 있어서 낮 시간 안에
 * 왕복하기엔 너무 멀었다. 몬스터 스폰 반경 바로 안팎으로만 좁혀서 — 위험을 살짝
 * 감수하는 정도의 거리로 맞췄다.
 *
 * 최소 거리는 플레이어 스폰 반경(40px, GameRoom/LocalConnection의 SPAWN_RADIUS)보다
 * 한참 더 떨어뜨려 뒀다 — 스폰하자마자 코앞에서 바로 채집이 시작되면 낮 시간의
 * "찾아간다"는 긴장감이 사라져서 너무 쉬워진다.
 */
const CLUSTER_MIN_DISTANCE = 150;
const CLUSTER_MAX_DISTANCE = 350;
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
  /** 퀵슬롯. 장착 무기도 여기서 나온다 — 클라이언트가 무기를 주장할 수 없다. */
  inventory: Inventory;
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
  private readonly rng: () => number;
  private readonly flowField = new FlowField(FLOW_FIELD_GRID, (cx, cy) =>
    this.buildings.isBlockedForMovement(cx, cy),
  );
  private readonly core: CoreState = {
    hp: wavesData.coreHp,
    maxHp: wavesData.coreHp,
    sharedWood: 0,
    sharedStone: 0,
  };
  private elapsedSeconds = 0;
  /** 이번 낮 페이즈에 스킵 투표를 던진 플레이어 id 집합. 만장일치면 skipDay()를 부른다. */
  private skipVotes = new Set<string>();

  constructor(options: WorldOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.recomputeFlowField();
    this.seedResourceNodes();
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
      inventory,
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
      !isFiniteNumber(input.aimAngle)
    ) {
      return;
    }

    // 순서가 뒤바뀌었거나 중복된 입력은 버린다. 받아들이면 lastProcessedSeq가 되감기고,
    // 클라이언트가 이미 확정한 구간을 다시 재조정하면서 캐릭터가 튄다.
    const previous = this.inputs.get(id);
    if (previous && input.seq <= previous.seq) return;

    const { moveX, moveY } = normalizeMoveVector(input.moveX, input.moveY);
    this.inputs.set(id, { seq: input.seq, moveX, moveY, aimAngle: input.aimAngle });
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

    // ResourceType이 늘어나면(현재 wood/stone 2종) 여기에 분기를 추가해야 한다 —
    // PlayerEntity가 자원별 전용 필드를 쓰는 설계라(범용 인벤토리 맵이 아니다) 자동으로
    // 확장되지 않는다.
    if (target.type === 'wood') player.wood += data.yieldOnDeplete;
    else if (target.type === 'stone') player.stone += data.yieldOnDeplete;
  }

  /**
   * 코어 입고 요청(E). 플레이어가 들고 있는(=아직 입고하지 않은) 나무/돌을 코어의
   * 공유 창고로 옮긴다 — 코어 반경 안에서만 되고, 들고 있는 게 하나도 없으면 조용히
   * 무시한다. 입고 즉시 개인 지갑은 0이 된다(다시 캐야 다음 몫이 생긴다).
   */
  depositAtCore(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    if (player.wood <= 0 && player.stone <= 0) return;

    const distance = Math.hypot(player.x, player.y); // 코어는 항상 원점(0,0)
    if (distance > CORE_INTERACT_RADIUS) return;

    this.core.sharedWood += player.wood;
    this.core.sharedStone += player.stone;
    player.wood = 0;
    player.stone = 0;
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

    const { x, y } = cellCenterWorld(cx, cy);
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
        const position = this.pickClusterNodePosition(clusterX, clusterY, placed);
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
        });
      }
    }
  }

  /**
   * 클러스터 중심 주변 `CLUSTER_JITTER_RADIUS` 안에서 무작위 위치를 고른다. 이미 놓인
   * 노드와 `MIN_NODE_SPACING`보다 가까우면 다시 뽑는다 — 몇 번 재시도해도 계속 겹치면
   * (좁은 지터 반경 안에 노드가 너무 많은 극단적인 경우) 완벽한 간격보다 무한 재시도
   * 방지가 우선이라 마지막으로 뽑은 위치를 그냥 쓴다.
   */
  private pickClusterNodePosition(
    centerX: number,
    centerY: number,
    placed: { x: number; y: number }[],
  ): { x: number; y: number } {
    const MAX_ATTEMPTS = 8;
    let candidate = { x: centerX, y: centerY };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = this.rng() * CLUSTER_JITTER_RADIUS;
      candidate = { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };

      const tooClose = placed.some(
        (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < MIN_NODE_SPACING,
      );
      if (!tooClose) return candidate;
    }

    return candidate;
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
  private tickResourceNodes(dtSeconds: number): void {
    for (const node of this.resourceNodes.values()) {
      if (node.respawnTimer <= 0) continue;
      node.respawnTimer -= dtSeconds;
      if (node.respawnTimer <= 0) {
        node.hp = resourcesData[node.type].hp;
        node.respawnTimer = 0;
      }
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
            target.hp = Math.max(0, target.hp - data.damage);
            monster.attackCooldown = data.attackInterval;
          }
        } else {
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
        player.hp = Math.max(0, player.hp - charge.damage);
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
        player.hp = Math.max(0, player.hp - slam.damage);
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

  /** 이동을 막는(blocksMovement) 건축물과 겹치는지 검사한다(플레이어-건축물 하드 충돌). */
  private isBlockedForPlayer(x: number, y: number): boolean {
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksMovement) continue;
      if (circlesOverlap(x, y, building.x, building.y, PLAYER_BUILDING_COLLISION_RADIUS)) {
        return true;
      }
    }
    return false;
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
   * 주 이동 방향(단위 벡터일 필요 없음)에 군집 분리를 더해 이동시킨다.
   *
   * 주 방향과 분리 벡터를 먼저 더한 뒤 그 합을 단위 벡터로 정규화하던 예전 방식은,
   * 몬스터가 코어와 일직선(예: y=0 축)에 있을 때 분리력이 주 방향과 같은 축 위에서만
   * 작용하면 정규화 후 결국 둘 다 똑같은 단위 벡터로 수렴해버려 — 분리력의 세기 차이가
   * 사라지고 두 몬스터가 완전히 같은 거리만큼 이동해 간격이 전혀 벌어지지 않는 버그가
   * 있었다. 주 방향은 그 자체로 단위 벡터로 정규화해 속도를 정하고, 분리 벡터는
   * 별도의 변위로 그 위에 더해야 몬스터마다 실제로 받는 분리력 세기가 이동 결과에 반영된다.
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

    monster.x += (normX * speed + separation.x * speed * SEPARATION_WEIGHT) * dtSeconds;
    monster.y += (normY * speed + separation.y * speed * SEPARATION_WEIGHT) * dtSeconds;
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
    this.damageMonster(closestId, monster.hp - projectile.damage);
    return true;
  }

  private applyMeleeHit(hit: MeleeHit): void {
    for (const [id, monster] of this.monsters) {
      if (withinMeleeArc(hit, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(id, monster.hp - hit.damage);
      }
    }
  }

  /**
   * 투사체 충돌 처리. 몬스터 판정을 먼저 하고, 못 맞혔으면 건축물 판정으로 넘어간다
   * — `blocksProjectile`인 건축물(벽)만 투사체를 막는다(울타리는 통과시킨다,
   * docs/backend/18 §1). 건축물은 데미지를 입지 않는다 — 몬스터 공격으로만 부서진다.
   */
  private resolveProjectileHits(): void {
    for (const [projectileId, projectile] of this.projectiles) {
      if (this.projectileHitsMonster(projectileId, projectile)) continue;
      this.projectileHitsBuilding(projectileId, projectile);
    }
  }

  private projectileHitsMonster(projectileId: string, projectile: ProjectileEntity): boolean {
    for (const [monsterId, monster] of this.monsters) {
      if (circlesOverlap(projectile.x, projectile.y, monster.x, monster.y, monsterRadius(monster))) {
        this.damageMonster(monsterId, monster.hp - projectile.damage);
        this.projectiles.delete(projectileId);
        return true;
      }
    }
    return false;
  }

  private projectileHitsBuilding(projectileId: string, projectile: ProjectileEntity): void {
    for (const building of this.buildings.values()) {
      if (!buildingsData[building.type].blocksProjectile) continue;
      if (circlesOverlap(projectile.x, projectile.y, building.x, building.y, TILE_SIZE / 2)) {
        this.projectiles.delete(projectileId);
        return;
      }
    }
  }

  private damageMonster(id: string, remainingHp: number): void {
    if (remainingHp <= 0) {
      this.monsters.delete(id);
      return;
    }
    const monster = this.monsters.get(id);
    if (monster) monster.hp = remainingHp;
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
