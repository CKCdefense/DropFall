import { TICK_RATE } from '../constants';
import { weaponsData, type WeaponType } from '../data';

/** 무기 데이터에 maxRange가 없을 때 쓰는 투사체 기본 사거리(px). */
const PROJECTILE_MAX_RANGE = 600;
/** 충돌 판정용 반지름(px). 몬스터/플레이어 히트박스를 원으로 근사한다. */
export const HIT_RADIUS = 10;

export interface ProjectileEntity {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * 진행 방향(라디안). vx/vy로도 구할 수 있지만, 클라이언트가 매 프레임 atan2를 돌리거나
   * 직전 좌표와 비교해 추측하지 않아도 되도록 발사 시점에 한 번 저장해 둔다.
   * 투사체는 직진만 하므로 수명 내내 바뀌지 않는다.
   */
  angle: number;
  damage: number;
  /** 이 사거리(px)를 넘으면 소멸한다 */
  remainingRange: number;
  /**
   * 관통 여부. true면 몬스터를 맞혀도 소멸하지 않고 계속 날아간다 —
   * 대신 같은 몬스터를 두 번 때리지 않도록 맞힌 id를 hitIds에 쌓는다.
   */
  pierce: boolean;
  /** pierce 전용: 이미 피해를 준 몬스터 id. 비관통 투사체는 만들 필요가 없어 옵셔널. */
  hitIds?: Set<string>;
  /**
   * 직전 틱의 위치. 충돌을 점이 아니라 **선분**(직전 위치 → 현재 위치)으로 판정하기
   * 위해 남긴다 — 저격탄은 초당 900px라 한 틱에 15px을 건너뛰는데, 몬스터 지름이
   * 20px 남짓이라 점 판정으로는 몸을 통과해도 아무 일도 일어나지 않는다.
   */
  prevX: number;
  prevY: number;
}

export interface MeleeHit {
  /** 이 공격을 날린 플레이어. 명중 처리를 누구 것으로 볼지 판정하는 데 쓴다. */
  ownerId: string;
  originX: number;
  originY: number;
  /** 판정 반경(px) */
  range: number;
  /** 부채꼴의 중심 방향(라디안) = 휘두른 순간의 조준각 */
  aimAngle: number;
  /**
   * 부채꼴의 **절반** 각도(라디안). 이 값이 π 이상이면 사실상 전방향 판정이다.
   * 절반으로 저장하는 이유: 판정식이 `|각도차| <= halfArc` 하나로 끝나서
   * 매 프레임 나눗셈을 반복하지 않는다.
   */
  halfArc: number;
  damage: number;
}

/** 전방향 판정을 뜻하는 halfArc 값. 이 이상이면 어떤 방향이든 통과한다. */
export const FULL_ARC = Math.PI;

/**
 * 두 각도의 최소 차이(0~π). 각도는 ±π에서 끊기므로 그냥 빼면 359도 차이가
 * 1도인데도 큰 값으로 나온다 — 한 바퀴를 접어서 실제 벌어진 각을 구한다.
 */
export function angleDifference(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  const diff = Math.abs(((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return diff > Math.PI ? TWO_PI - diff : diff;
}

/**
 * 대상이 근접 부채꼴 안에 있는지 판정한다.
 *
 * 거리는 원, 방향은 부채꼴 — 둘 다 만족해야 맞는다. 다만 **아주 가까우면 방향을 보지 않는다**:
 * 몸이 겹칠 만큼 붙은 적이 등 뒤에 있다는 이유로 안 맞으면, 붙어서 빙빙 도는 몬스터에게
 * 아무것도 못 하는 상황이 생긴다.
 */
export function withinMeleeArc(
  hit: MeleeHit,
  targetX: number,
  targetY: number,
  targetRadius: number,
): boolean {
  const dx = targetX - hit.originX;
  const dy = targetY - hit.originY;
  const distance = Math.hypot(dx, dy);

  if (distance > hit.range + targetRadius) return false;
  if (hit.halfArc >= FULL_ARC) return true;
  // 히트박스 안쪽에 있으면 방향 판정을 건너뛴다(밀착 상태의 사각지대 방지).
  if (distance <= targetRadius) return true;

  // 대상이 클수록/가까울수록 각도 여유를 준다 — 중심점은 부채꼴 밖이어도
  // 몸의 일부가 걸치면 맞는 게 맞다.
  const radiusSlack = Math.asin(Math.min(1, targetRadius / distance));
  return angleDifference(Math.atan2(dy, dx), hit.aimAngle) <= hit.halfArc + radiusSlack;
}

export interface FireRequest {
  playerId: string;
  weaponId: string;
  x: number;
  y: number;
  aimAngle: number;
}

export interface FireResult {
  /**
   * 이번 발사로 생겨난 투사체들. 보통 1개지만 산탄(pellets)은 여러 개가 부채꼴로
   * 퍼져 나온다 — 호출자는 개수와 무관하게 배열을 순회하면 된다.
   */
  projectiles?: ProjectileEntity[];
  meleeHit?: MeleeHit;
}

let nextProjectileId = 1;

/** 테스트에서 결정론적으로 검증할 수 있도록 id 시퀀스를 리셋한다. */
export function resetProjectileIdSequence(): void {
  nextProjectileId = 1;
}

/**
 * 쿨다운 판정에 주는 여유(초). 한 틱 분량이다.
 *
 * 클라이언트가 정확히 발사 주기마다 보내도, 네트워크 지터와 틱 경계 때문에 요청이
 * 쿨다운 직전에 도착하는 일이 생긴다. 여유가 없으면 그런 요청이 거절되고 **다음 주기까지
 * 통째로 밀려서** 실제 연사속도가 절반으로 떨어진다.
 *
 * 한 틱만큼 일찍 쏠 수 있게 되지만(권총 기준 6% 빠름) 밸런스에 의미 있는 차이는 아니다.
 */
const FIRE_COOLDOWN_GRACE = 1 / TICK_RATE;

/**
 * 플레이어별·무기별 발사 쿨다운을 추적한다. "서버 권위" 모델의 일부 —
 * 클라이언트가 fireRate보다 빠르게 발사 메시지를 보내도 서버가 무시한다.
 */
export class WeaponCooldowns {
  private lastFireAt = new Map<string, number>();

  private key(playerId: string, weaponId: string): string {
    return `${playerId}:${weaponId}`;
  }

  canFire(playerId: string, weaponId: string, now: number): boolean {
    const weapon = weaponsData[weaponId as WeaponType];
    if (!weapon) return false;

    const last = this.lastFireAt.get(this.key(playerId, weaponId));
    if (last === undefined) return true;
    return now - last >= 1 / weapon.fireRate - FIRE_COOLDOWN_GRACE;
  }

  recordFire(playerId: string, weaponId: string, now: number): void {
    this.lastFireAt.set(this.key(playerId, weaponId), now);
  }

  removePlayer(playerId: string): void {
    for (const key of this.lastFireAt.keys()) {
      if (key.startsWith(`${playerId}:`)) this.lastFireAt.delete(key);
    }
  }
}

/**
 * 서버 권위 발사 처리. 쿨다운 통과 여부는 호출자가 WeaponCooldowns로 미리 검증해야 한다.
 * 존재하지 않는 무기 id면 빈 결과를 반환한다 — 클라이언트 입력을 신뢰하지 않는다.
 */
export function resolveFire(request: FireRequest): FireResult {
  const weapon = weaponsData[request.weaponId as WeaponType];
  if (!weapon) return {};

  if (weapon.type === 'melee') {
    return {
      meleeHit: {
        ownerId: request.playerId,
        originX: request.x,
        originY: request.y,
        range: weapon.range ?? 0,
        aimAngle: request.aimAngle,
        // arc가 없는 무기는 예전처럼 전방향으로 둔다 — 데이터만 추가하면 부채꼴이 된다.
        halfArc: weapon.arc === undefined ? FULL_ARC : (weapon.arc * Math.PI) / 360,
        damage: weapon.damage,
      },
    };
  }

  const speed = weapon.projectileSpeed ?? 0;
  // 총구에서 나가게 한다. 플레이어 중심에서 쏘면 총알이 몸통에서 튀어나오는 것처럼 보이고,
  // 코앞의 적이 총구보다 안쪽에 있을 때 스쳐 지나가는 문제도 생긴다.
  const offset = weapon.muzzleOffset ?? 0;
  // 총구까지 밀어낸 만큼 사거리도 줄인다 — 안 그러면 무기마다 실제 사거리가 달라진다.
  const range = Math.max(0, (weapon.maxRange ?? PROJECTILE_MAX_RANGE) - offset);

  // 산탄이 아니면 1발. 산탄은 spreadDeg 전체 각을 펠릿 수로 균등 분할해 부채꼴로 낸다 —
  // 무작위 흩뿌림은 판정을 재현할 수 없어 테스트도 밸런스 감각도 흐려진다.
  const pellets = weapon.pellets ?? 1;
  const spread = ((weapon.spreadDeg ?? 0) * Math.PI) / 180;
  const projectiles: ProjectileEntity[] = [];
  for (let i = 0; i < pellets; i++) {
    const angle =
      pellets === 1 ? request.aimAngle : request.aimAngle + spread * (i / (pellets - 1) - 0.5);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    projectiles.push({
      id: `proj_${nextProjectileId++}`,
      ownerId: request.playerId,
      x: request.x + cos * offset,
      y: request.y + sin * offset,
      vx: cos * speed,
      vy: sin * speed,
      angle,
      damage: weapon.damage,
      remainingRange: range,
      pierce: weapon.pierce ?? false,
      hitIds: weapon.pierce ? new Set() : undefined,
      prevX: request.x + cos * offset,
      prevY: request.y + sin * offset,
    });
  }

  return { projectiles };
}

/**
 * 플레이어별·무기별 탄창 상태. 무기를 바꿔 들어도 각 무기의 남은 탄약은 유지된다.
 * 발사(consume)로 비면 자동으로 재장전이 시작되고, 수동 재장전(R)도 같은 경로를 쓴다.
 * 재장전 중에는 발사할 수 없다. magazine이 없는 무기(근접·맨손)는 전부 통과시킨다.
 */
export class WeaponAmmo {
  private state = new Map<string, { loaded: number; reloadTimer: number }>();

  private key(playerId: string, weaponId: string): string {
    return `${playerId}:${weaponId}`;
  }

  private stateOf(playerId: string, weaponId: string): { loaded: number; reloadTimer: number } {
    const key = this.key(playerId, weaponId);
    let entry = this.state.get(key);
    if (!entry) {
      const magazine = weaponsData[weaponId as WeaponType]?.magazine ?? 0;
      entry = { loaded: magazine, reloadTimer: 0 };
      this.state.set(key, entry);
    }
    return entry;
  }

  /** 남은 탄약/재장전 잔여 시간 조회(HUD 동기화용). magazine 없는 무기는 null. */
  view(playerId: string, weaponId: string): { loaded: number; reloadRemaining: number } | null {
    const weapon = weaponsData[weaponId as WeaponType];
    if (!weapon?.magazine) return null;
    const entry = this.stateOf(playerId, weaponId);
    return { loaded: entry.loaded, reloadRemaining: entry.reloadTimer };
  }

  /**
   * 한 발 소모를 시도한다. 성공하면 true. 재장전 중이거나 탄이 없으면 false —
   * 탄이 없으면 그 자리에서 자동 재장전을 시작한다(빈 총 딸깍임과 동시에 장전).
   */
  tryConsume(playerId: string, weaponId: string): boolean {
    const weapon = weaponsData[weaponId as WeaponType];
    if (!weapon?.magazine) return true;

    const entry = this.stateOf(playerId, weaponId);
    if (entry.reloadTimer > 0) return false;
    if (entry.loaded <= 0) {
      this.startReload(playerId, weaponId);
      return false;
    }
    entry.loaded -= 1;
    if (entry.loaded <= 0) this.startReload(playerId, weaponId);
    return true;
  }

  /** 재장전 시작. 이미 가득이거나 재장전 중이면 무시한다. */
  startReload(playerId: string, weaponId: string): void {
    const weapon = weaponsData[weaponId as WeaponType];
    if (!weapon?.magazine || weapon.reloadTime === undefined) return;
    const entry = this.stateOf(playerId, weaponId);
    if (entry.reloadTimer > 0 || entry.loaded >= weapon.magazine) return;
    entry.reloadTimer = weapon.reloadTime;
  }

  /** 매 틱 재장전 타이머를 줄이고, 끝난 무기는 탄창을 가득 채운다. */
  tick(dtSeconds: number): void {
    for (const [key, entry] of this.state) {
      if (entry.reloadTimer <= 0) continue;
      entry.reloadTimer -= dtSeconds;
      if (entry.reloadTimer <= 0) {
        entry.reloadTimer = 0;
        const weaponId = key.slice(key.indexOf(':') + 1);
        entry.loaded = weaponsData[weaponId as WeaponType]?.magazine ?? entry.loaded;
      }
    }
  }

  removePlayer(playerId: string): void {
    for (const key of this.state.keys()) {
      if (key.startsWith(`${playerId}:`)) this.state.delete(key);
    }
  }
}

/** 매 틱 투사체를 이동시키고, 사거리를 넘은 투사체는 제거한다. */
export function tickProjectiles(
  projectiles: Map<string, ProjectileEntity>,
  dtSeconds: number,
): void {
  for (const [id, projectile] of projectiles) {
    const stepX = projectile.vx * dtSeconds;
    const stepY = projectile.vy * dtSeconds;
    projectile.prevX = projectile.x;
    projectile.prevY = projectile.y;
    projectile.x += stepX;
    projectile.y += stepY;
    projectile.remainingRange -= Math.hypot(stepX, stepY);
    if (projectile.remainingRange <= 0) projectiles.delete(id);
  }
}

/**
 * 이번 틱에 투사체가 지나간 **선분**이 원형 히트박스를 스쳤는지 검사한다.
 *
 * 점(현재 위치)만 보면 빠른 총알이 대상을 뛰어넘는다 — 저격탄(900px/s)은 한 틱에
 * 15px을 가는데 잡몹 지름이 20px 남짓이라, 조준이 정확해도 그냥 통과해 버리는 일이
 * 실제로 생겼다. 선분과 원 중심의 최단거리로 판정하면 속도와 무관하게 맞는다.
 */
export function projectileSweepHits(
  projectile: Pick<ProjectileEntity, 'x' | 'y' | 'prevX' | 'prevY'>,
  targetX: number,
  targetY: number,
  radius: number,
): boolean {
  const dx = projectile.x - projectile.prevX;
  const dy = projectile.y - projectile.prevY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return circlesOverlap(projectile.x, projectile.y, targetX, targetY, radius);
  }

  const t = ((targetX - projectile.prevX) * dx + (targetY - projectile.prevY) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  const closestX = projectile.prevX + dx * clamped;
  const closestY = projectile.prevY + dy * clamped;
  return circlesOverlap(closestX, closestY, targetX, targetY, radius);
}

/** 두 원형 히트박스가 겹치는지 검사한다. */
export function circlesOverlap(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  combinedRadius: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) <= combinedRadius;
}
