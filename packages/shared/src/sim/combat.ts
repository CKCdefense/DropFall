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
  damage: number;
  /** 이 사거리(px)를 넘으면 소멸한다 */
  remainingRange: number;
}

export interface MeleeHit {
  originX: number;
  originY: number;
  /** 판정 반경(px). 조준 방향과 무관하게 사용자 주변 원형 판정이다 — 방향성 콘/화살표는 후속 작업 */
  range: number;
  damage: number;
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
    return now - last >= 1 / weapon.fireRate;
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
        damage: weapon.damage,
      },
    };
  }

  const speed = weapon.projectileSpeed ?? 0;
  return {
    projectile: {
      id: `proj_${nextProjectileId++}`,
      ownerId: request.playerId,
      x: request.x,
      y: request.y,
      vx: Math.cos(request.aimAngle) * speed,
      vy: Math.sin(request.aimAngle) * speed,
      damage: weapon.damage,
      remainingRange: PROJECTILE_MAX_RANGE,
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
