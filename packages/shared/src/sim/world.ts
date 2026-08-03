import { TILE_SIZE } from '../constants';
import { monstersData, wavesData, type MonsterType } from '../data';
import type { PlayerInputMessage } from '../protocol/messages';
import { FlowField, type FlowFieldGrid } from './ai/flowField';
import {
  HIT_RADIUS,
  WeaponCooldowns,
  circlesOverlap,
  resolveFire,
  tickProjectiles,
  type MeleeHit,
  type ProjectileEntity,
} from './combat';
import { normalizeMoveVector, stepPosition } from './movement';
import { WaveManager, type GamePhase } from './wave';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 맵 그리드 크기(타일). 기술명세 §5.1 예시(128×128)를 그대로 따른다. */
const MAP_SIZE_TILES = 128;
const FLOW_FIELD_GRID: FlowFieldGrid = {
  widthInTiles: MAP_SIZE_TILES,
  heightInTiles: MAP_SIZE_TILES,
  tileSize: TILE_SIZE,
  originX: -(MAP_SIZE_TILES * TILE_SIZE) / 2,
  originY: -(MAP_SIZE_TILES * TILE_SIZE) / 2,
};
/** 코어 자체의 판정 반경(px). 몬스터의 attackRange에 더해져 "코어에 도달했다"를 정의한다. */
const CORE_RADIUS = TILE_SIZE;
/** 이 거리보다 가까운 몬스터끼리는 서로 밀어낸다 — 군집 분리(기술명세 §5.3). */
const SEPARATION_RADIUS = HIT_RADIUS * 2.5;
/** 분리력이 주 이동 방향을 완전히 덮어쓰지 않도록 두는 가중치. */
const SEPARATION_WEIGHT = 0.6;
/** 한 번 잡은 어그로 타겟은 아그로 반경의 이 배수를 벗어나기 전까진 유지한다(타겟 떨림 방지). */
const AGGRO_LEASH_MULTIPLIER = 1.5;

export interface PlayerEntity {
  id: string;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
  hp: number;
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
}

export interface CoreState {
  hp: number;
  maxHp: number;
}

let nextMonsterId = 1;

export class World {
  private players = new Map<string, PlayerEntity>();
  private inputs = new Map<string, PlayerInputMessage>();
  private monsters = new Map<string, MonsterEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private readonly cooldowns = new WeaponCooldowns();
  private readonly waveManager = new WaveManager();
  private readonly flowField = new FlowField(FLOW_FIELD_GRID);
  private readonly core: CoreState = { hp: wavesData.coreHp, maxHp: wavesData.coreHp };
  private elapsedSeconds = 0;
  /** 이번 낮 페이즈에 스킵 투표를 던진 플레이어 id 집합. 만장일치면 skipDay()를 부른다. */
  private skipVotes = new Set<string>();

  constructor() {
    const coreCell = this.flowField.worldToCell(0, 0);
    this.flowField.recompute(coreCell.cx, coreCell.cy);
  }

  addPlayer(id: string, x = 0, y = 0): void {
    this.players.set(id, { id, x, y, aimAngle: 0, lastProcessedSeq: 0, hp: wavesData.playerHp });
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
   * 발사 요청 처리. weaponId는 네트워크 경계를 넘어온 값이라 타입부터 검증한다
   * (unknown weaponId/쿨다운 미달은 WeaponCooldowns/resolveFire가 조용히 무시한다).
   */
  fireWeapon(playerId: string, weaponId: unknown): void {
    if (typeof weaponId !== 'string') return;

    const player = this.players.get(playerId);
    if (!player) return;
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
    this.waveManager.tick(dtSeconds, this.monsters.size, (type, x, y) =>
      this.addMonster(type, x, y),
    );
    // 밤이 끝나고 새 낮이 시작되는 시점(웨이브 클리어) — 다운된 플레이어를 부활시키고
    // 지난 낮의 스킵 투표를 초기화한다(docs/backend/11 §4.1).
    if (previousPhase !== 'day' && this.waveManager.currentPhase === 'day') {
      this.revivePlayers();
      this.skipVotes.clear();
    }

    this.tickMonsters(dtSeconds);

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

  getWavePhase(): GamePhase {
    return this.waveManager.currentPhase;
  }

  getCurrentWave(): number {
    return this.waveManager.currentWave;
  }

  /** 현재 낮 스킵 투표에 동의한 인원 수. 필요 인원은 접속 중인 전원(getPlayers().size)이다. */
  getSkipVoteCount(): number {
    return this.skipVotes.size;
  }

  private addMonster(type: MonsterType, x: number, y: number): void {
    const data = monstersData[type];
    const id = `monster_${nextMonsterId++}`;
    this.monsters.set(id, { id, type, x, y, hp: data.hp, maxHp: data.hp, attackCooldown: 0 });
  }

  /** 다운된(hp 0) 플레이어는 이미 전투 불능이라 몬스터의 추격/공격 대상에서 제외한다. */
  private findNearestPlayer(x: number, y: number, radius: number): PlayerEntity | undefined {
    let nearest: PlayerEntity | undefined;
    let nearestDistance = radius;

    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      const distance = Math.hypot(player.x - x, player.y - y);
      if (distance <= nearestDistance) {
        nearest = player;
        nearestDistance = distance;
      }
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

  /**
   * 몬스터 행동: 어그로 반경이 있고 반경 내 플레이어가 있으면 직접 추격(돌진형/보스),
   * 아니면 Flow Field를 따라 코어로 향한다(잡몹/탱커형). 사거리 안에 들어오면 이동을
   * 멈추고 공격 주기(attackInterval)마다 대미지를 준다. 실제 이동에는 군집 분리를
   * 섞어서(moveMonster) 여러 마리가 완전히 겹쳐 스택되지 않게 한다.
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
        if (distance <= data.attackRange) {
          if (monster.attackCooldown <= 0) {
            target.hp = Math.max(0, target.hp - data.damage);
            monster.attackCooldown = data.attackInterval;
          }
        } else {
          this.moveMonster(
            monster,
            (target.x - monster.x) / distance,
            (target.y - monster.y) / distance,
            data.speed,
            dtSeconds,
          );
        }
        continue;
      }

      const distanceToCore = Math.hypot(monster.x, monster.y);
      if (distanceToCore <= data.attackRange + CORE_RADIUS) {
        if (monster.attackCooldown <= 0) {
          this.core.hp = Math.max(0, this.core.hp - data.damage);
          monster.attackCooldown = data.attackInterval;
        }
      } else {
        const dir = this.flowField.sampleDirection(monster.x, monster.y);
        this.moveMonster(monster, dir.x, dir.y, data.speed, dtSeconds);
      }
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

    const next = this.findNearestPlayer(monster.x, monster.y, aggroRadius);
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

  /** 주 이동 방향(단위 벡터일 필요 없음)에 군집 분리를 섞어 정규화한 뒤 이동시킨다. */
  private moveMonster(
    monster: MonsterEntity,
    dirX: number,
    dirY: number,
    speed: number,
    dtSeconds: number,
  ): void {
    const separation = this.computeSeparation(monster);
    let vx = dirX + separation.x * SEPARATION_WEIGHT;
    let vy = dirY + separation.y * SEPARATION_WEIGHT;

    const length = Math.hypot(vx, vy);
    if (length > 0) {
      vx /= length;
      vy /= length;
    }

    monster.x += vx * speed * dtSeconds;
    monster.y += vy * speed * dtSeconds;
  }

  private applyMeleeHit(hit: MeleeHit): void {
    for (const [id, monster] of this.monsters) {
      if (circlesOverlap(hit.originX, hit.originY, monster.x, monster.y, hit.range + HIT_RADIUS)) {
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
