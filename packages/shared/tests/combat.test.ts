import { beforeEach, describe, expect, it } from 'vitest';
import {
  WeaponCooldowns,
  circlesOverlap,
  resetProjectileIdSequence,
  resolveFire,
  tickProjectiles,
  type ProjectileEntity,
} from '../src/sim/combat';

beforeEach(() => {
  resetProjectileIdSequence();
});

describe('resolveFire', () => {
  it('근접 무기는 발사 지점 중심의 원형 판정을 반환한다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'club', x: 10, y: 20, aimAngle: 0 });
    expect(result.projectile).toBeUndefined();
    expect(result.meleeHit).toEqual({ originX: 10, originY: 20, range: 24, damage: 15 });
  });

  it('원거리 무기는 조준각 방향으로 날아가는 투사체를 만든다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'pistol', x: 0, y: 0, aimAngle: 0 });
    expect(result.meleeHit).toBeUndefined();
    expect(result.projectile?.vx).toBeCloseTo(420, 5);
    expect(result.projectile?.vy).toBeCloseTo(0, 5);
    expect(result.projectile?.damage).toBe(12);
  });

  it('존재하지 않는 무기 id는 빈 결과를 반환한다(클라이언트 입력 불신)', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'not-a-weapon', x: 0, y: 0, aimAngle: 0 });
    expect(result).toEqual({});
  });
});

describe('WeaponCooldowns', () => {
  it('처음 발사는 항상 허용한다', () => {
    const cooldowns = new WeaponCooldowns();
    expect(cooldowns.canFire('p1', 'pistol', 0)).toBe(true);
  });

  it('fireRate 간격 전에는 다시 발사할 수 없다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'pistol', 0); // fireRate 4 → 0.25초 간격
    expect(cooldowns.canFire('p1', 'pistol', 0.1)).toBe(false);
    expect(cooldowns.canFire('p1', 'pistol', 0.25)).toBe(true);
  });

  it('플레이어별로 독립적으로 추적한다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'pistol', 0);
    expect(cooldowns.canFire('p2', 'pistol', 0)).toBe(true);
  });

  it('removePlayer 이후에는 다시 처음 발사로 취급한다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'pistol', 0);
    cooldowns.removePlayer('p1');
    expect(cooldowns.canFire('p1', 'pistol', 0.01)).toBe(true);
  });
});

describe('tickProjectiles', () => {
  it('속도에 비례해 이동한다', () => {
    const projectiles = new Map<string, ProjectileEntity>([
      ['a', { id: 'a', ownerId: 'p1', x: 0, y: 0, vx: 100, vy: 0, damage: 1, remainingRange: 600 }],
    ]);
    tickProjectiles(projectiles, 1);
    expect(projectiles.get('a')?.x).toBe(100);
  });

  it('사거리를 다 쓰면 제거된다', () => {
    const projectiles = new Map<string, ProjectileEntity>([
      ['a', { id: 'a', ownerId: 'p1', x: 0, y: 0, vx: 1000, vy: 0, damage: 1, remainingRange: 10 }],
    ]);
    tickProjectiles(projectiles, 1);
    expect(projectiles.has('a')).toBe(false);
  });
});

describe('circlesOverlap', () => {
  it('반경 합보다 가까우면 겹친 것으로 본다', () => {
    expect(circlesOverlap(0, 0, 5, 0, 10)).toBe(true);
  });

  it('반경 합보다 멀면 안 겹친다', () => {
    expect(circlesOverlap(0, 0, 100, 0, 10)).toBe(false);
  });
});
