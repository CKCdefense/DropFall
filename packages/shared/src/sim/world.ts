import { MAP_ORIGIN, MAP_SIZE_TILES, TILE_SIZE, cellCenterWorld, worldToCell } from '../constants';
import {
  buildingsData,
  loadoutData,
  monstersData,
  resourcesData,
  wavesData,
  type BuildingType,
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

const FLOW_FIELD_GRID: FlowFieldGrid = {
  widthInTiles: MAP_SIZE_TILES,
  heightInTiles: MAP_SIZE_TILES,
  tileSize: TILE_SIZE,
  originX: MAP_ORIGIN,
  originY: MAP_ORIGIN,
};
/** 코어 자체의 판정 반경(px). 몬스터의 attackRange에 더해져 "코어에 도달했다"를 정의한다. */
const CORE_RADIUS = TILE_SIZE;
/** 이 거리보다 가까운 몬스터끼리는 서로 밀어낸다 — 군집 분리(기술명세 §5.3). */
const SEPARATION_RADIUS = HIT_RADIUS * 2.5;
/** 분리력이 주 이동 방향을 완전히 덮어쓰지 않도록 두는 가중치. */
const SEPARATION_WEIGHT = 0.6;
/** 한 번 잡은 어그로 타겟은 아그로 반경의 이 배수를 벗어나기 전까진 유지한다(타겟 떨림 방지). */
const AGGRO_LEASH_MULTIPLIER = 1.5;
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
 */
const CLUSTER_MIN_DISTANCE = 100;
const CLUSTER_MAX_DISTANCE = 350;
/** 클러스터 중심 주변으로 노드가 흩어지는 반경(px). */
const CLUSTER_JITTER_RADIUS = 48;
/** 같은 클러스터 안에서 노드끼리 이 거리보다 가깝게는 두지 않는다(완전히 겹치는 것 방지). */
const MIN_NODE_SPACING = 20;

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
  remainingHarvests: number;
  /** 0이면 채집 가능. 고갈되면 resourcesData[type].respawnSeconds로 세팅되고 매 틱 감소한다. */
  respawnTimer: number;
}

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
}

export interface CoreState {
  hp: number;
  maxHp: number;
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
  /** `${playerId}:${resourceType}` → 마지막 채집 시각(elapsedSeconds). harvestInterval 속도 제한용. */
  private readonly lastHarvestAt = new Map<string, number>();
  private readonly rng: () => number;
  private readonly flowField = new FlowField(FLOW_FIELD_GRID, (cx, cy) =>
    this.buildings.isBlockedForMovement(cx, cy),
  );
  private readonly core: CoreState = { hp: wavesData.coreHp, maxHp: wavesData.coreHp };
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

    if (result.projectile) this.projectiles.set(result.projectile.id, result.projectile);
    if (result.meleeHit) this.applyMeleeHit(result.meleeHit);
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
   * 채집 요청. 타겟을 지정하지 않는다 — 플레이어 위치 기준 반경 안의, 아직 고갈되지
   * 않은 가장 가까운 노드 하나에 자동으로 적용된다(근접 무기 판정과 같은 반경 스캔
   * 방식). `fire()`처럼 호출 자체는 상태 없는 단발 액션이고, 클라이언트가 "E 홀드"
   * 동안 반복 전송하는 방식으로 채널링 UX를 낸다(docs/backend/18 §3.1) — 서버는
   * `harvestInterval` 쿨다운으로만 속도를 제한한다. 도구 소유권 검사는 없다(§확정한
   * 설계 결정 1 — 상점이 없어서 검사할 대상 자체가 없다).
   */
  harvest(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    let target: ResourceNodeEntity | undefined;
    let targetDistance = Infinity;
    for (const node of this.resourceNodes.values()) {
      if (node.remainingHarvests <= 0) continue;
      const data = resourcesData[node.type];
      const distance = Math.hypot(node.x - player.x, node.y - player.y);
      if (distance > data.harvestRadius || distance >= targetDistance) continue;
      target = node;
      targetDistance = distance;
    }
    if (!target) return;

    const data = resourcesData[target.type];
    const cooldownKey = `${playerId}:${target.type}`;
    const lastHarvest = this.lastHarvestAt.get(cooldownKey);
    if (lastHarvest !== undefined && this.elapsedSeconds - lastHarvest < data.harvestInterval) return;
    this.lastHarvestAt.set(cooldownKey, this.elapsedSeconds);

    target.remainingHarvests -= 1;
    if (target.remainingHarvests <= 0) target.respawnTimer = data.respawnSeconds;

    // ResourceType이 늘어나면(현재 wood/stone 2종) 여기에 분기를 추가해야 한다 —
    // PlayerEntity가 자원별 전용 필드를 쓰는 설계라(범용 인벤토리 맵이 아니다) 자동으로
    // 확장되지 않는다.
    if (target.type === 'wood') player.wood += data.yieldPerHarvest;
    else if (target.type === 'stone') player.stone += data.yieldPerHarvest;
  }

  /**
   * 건축 요청 처리. `buildingType`/`cx`/`cy`는 네트워크 경계를 넘어온 값이라 타입부터
   * 검증한다. 배치 규칙(docs/backend/18 §3.5): 이미 다른 건축물/자원 노드/코어가 있는
   * 셀, 플레이어가 서 있는 셀엔 지을 수 없다. 비용은 설치를 요청한 플레이어의
   * 인벤토리에서만 차감한다(팀원 자원을 모아서 내는 기능은 범위 밖).
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

    const player = this.players.get(playerId);
    if (!player) return;
    if (player.wood < data.woodCost || player.stone < data.stoneCost) return;

    player.wood -= data.woodCost;
    player.stone -= data.stoneCost;

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
      const next = stepPosition(player.x, player.y, input.moveX, input.moveY, dtSeconds);
      player.x = next.x;
      player.y = next.y;
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
          remainingHarvests: data.maxHarvests,
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
        node.remainingHarvests = resourcesData[node.type].maxHarvests;
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
   * 살아있는 목표(추격 타겟 → 코어)가 항상 최우선이고, 둘 다 사거리 밖이라 이동해야
   * 하는데 그 자리에서 공격 사거리 안에 이동을 막는 건축물이 있으면 이동 대신 그것부터
   * 공격한다(docs/backend/24, 기술명세 §5.3 "막힘 감지"의 단순화 버전 — 정밀한 우회
   * 비용 비교 대신 기존 근접 판정과 동일한 반경 기반 규칙을 쓴다).
   *
   * `facingX/Y`는 이 함수가 매 틱 끝에 갱신한다 — 추격 중이면 타겟 방향, 코어를 공격
   * 중이면 코어 방향, 그 외엔 Flow Field 방향. 전부 이미 계산해 둔 벡터라 이 갱신
   * 자체는 추가 비용이 거의 없다(대입 두 번).
   */
  private tickMonsters(dtSeconds: number): void {
    for (const monster of this.monsters.values()) {
      const data = monstersData[monster.type];
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dtSeconds);

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

        if (distance <= data.attackRange) {
          if (monster.attackCooldown <= 0) {
            target.hp = Math.max(0, target.hp - data.damage);
            monster.attackCooldown = data.attackInterval;
          }
        } else {
          const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
          if (blocker) {
            this.attackBuilding(monster, blocker, data.damage, data.attackInterval);
          } else {
            this.moveMonster(monster, monster.facingX, monster.facingY, data.speed, dtSeconds);
          }
        }
        continue;
      }

      const distanceToCore = Math.hypot(monster.x, monster.y);
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

      const blocker = this.findBlockingBuildingInRange(monster, data.attackRange);
      if (blocker) {
        this.attackBuilding(monster, blocker, data.damage, data.attackInterval);
        continue;
      }

      // 코어까지 막힌 셀이 없으면 Flow Field(격자 8방향으로만 방향을 낼 수 있어 각도가
      // 유한하게 끊긴다) 대신 코어를 향한 진짜 연속각으로 직진시킨다 — 실제로 피할
      // 장애물이 있을 때만 Flow Field 방향으로 우회한다(backend/21).
      const direct = this.flowField.hasLineOfSight(monster.x, monster.y, 0, 0);
      const dir = direct
        ? { x: -monster.x / distanceToCore, y: -monster.y / distanceToCore }
        : this.flowField.sampleDirection(monster.x, monster.y);
      // {0,0}(도달 불가)이면 바라보던 방향을 그대로 둔다 — 방향 없는 시야는 의미가 없다.
      if (dir.x !== 0 || dir.y !== 0) {
        monster.facingX = dir.x;
        monster.facingY = dir.y;
      }
      this.moveMonster(monster, dir.x, dir.y, data.speed, dtSeconds);
    }
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

  private applyMeleeHit(hit: MeleeHit): void {
    for (const [id, monster] of this.monsters) {
      if (withinMeleeArc(hit, monster.x, monster.y, HIT_RADIUS)) {
        this.damageMonster(id, monster.hp - hit.damage);
      }
    }
  }

  private resolveProjectileHits(): void {
    for (const [projectileId, projectile] of this.projectiles) {
      for (const [monsterId, monster] of this.monsters) {
        if (circlesOverlap(projectile.x, projectile.y, monster.x, monster.y, HIT_RADIUS)) {
          this.damageMonster(monsterId, monster.hp - projectile.damage);
          this.projectiles.delete(projectileId);
          break;
        }
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
