import { TICK_RATE } from '../constants';
import { weaponsData, type WeaponType } from '../data';

/** 투사체가 이 거리(px)를 넘어가면 소멸한다. */
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
}

export interface MeleeHit {
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
  projectile?: ProjectileEntity;
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
  const cos = Math.cos(request.aimAngle);
  const sin = Math.sin(request.aimAngle);
  // 총구에서 나가게 한다. 플레이어 중심에서 쏘면 총알이 몸통에서 튀어나오는 것처럼 보이고,
  // 코앞의 적이 총구보다 안쪽에 있을 때 스쳐 지나가는 문제도 생긴다.
  const offset = weapon.muzzleOffset ?? 0;

  return {
    projectile: {
      id: `proj_${nextProjectileId++}`,
      ownerId: request.playerId,
      x: request.x + cos * offset,
      y: request.y + sin * offset,
      vx: cos * speed,
      vy: sin * speed,
      angle: request.aimAngle,
      damage: weapon.damage,
      // 총구까지 밀어낸 만큼 사거리도 줄인다 — 안 그러면 무기마다 실제 사거리가 달라진다.
      remainingRange: Math.max(0, PROJECTILE_MAX_RANGE - offset),
    },
  };
}

/** 매 틱 투사체를 이동시키고, 사거리를 넘은 투사체는 제거한다. */
export function tickProjectiles(
  projectiles: Map<string, ProjectileEntity>,
  dtSeconds: number,
): void {
  for (const [id, projectile] of projectiles) {
    const stepX = projectile.vx * dtSeconds;
    const stepY = projectile.vy * dtSeconds;
    projectile.x += stepX;
    projectile.y += stepY;
    projectile.remainingRange -= Math.hypot(stepX, stepY);
    if (projectile.remainingRange <= 0) projectiles.delete(id);
  }
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
