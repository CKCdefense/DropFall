import { beforeEach, describe, expect, it } from 'vitest';
import { weaponsData } from '../src/data';
import {
  FULL_ARC,
  WeaponCooldowns,
  angleDifference,
  circlesOverlap,
  resetProjectileIdSequence,
  resolveFire,
  tickProjectiles,
  withinMeleeArc,
  type MeleeHit,
  type ProjectileEntity,
} from '../src/sim/combat';

beforeEach(() => {
  resetProjectileIdSequence();
});

describe('resolveFire', () => {
  it('근접 무기는 조준 방향을 중심으로 한 부채꼴 판정을 반환한다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'axe_t1', x: 10, y: 20, aimAngle: 0.5 });
    expect(result.projectile).toBeUndefined();
    expect(result.meleeHit).toEqual({
      ownerId: 'p1',
      originX: 10,
      originY: 20,
      range: weaponsData.axe_t1.range!,
      aimAngle: 0.5,
      // arc 100도 → 절반인 50도
      halfArc: (50 * Math.PI) / 180,
      damage: weaponsData.axe_t1.damage,
    });
  });

  it('원거리 무기는 조준각 방향으로 날아가는 투사체를 만든다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'handgun', x: 0, y: 0, aimAngle: 0 });
    const projectile = result.projectiles?.[0];
    expect(result.meleeHit).toBeUndefined();
    expect(result.projectiles).toHaveLength(1);
    expect(projectile?.vx).toBeCloseTo(weaponsData.handgun.projectileSpeed!, 5);
    expect(projectile?.vy).toBeCloseTo(0, 5);
    expect(projectile?.damage).toBe(weaponsData.handgun.damage);
    expect(projectile?.angle).toBe(0);
  });

  it('투사체는 플레이어 중심이 아니라 총구에서 나간다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'handgun', x: 10, y: 20, aimAngle: 0 });

    // 총구 거리는 스프라이트에서 잰 값이라 무기마다 다르다 — 숫자를 박아두면
    // 그림을 고칠 때마다 테스트가 깨진다. 데이터에서 읽어 쓴다.
    const offset = weaponsData.handgun.muzzleOffset!;
    expect(result.projectiles?.[0]?.x).toBeCloseTo(10 + offset, 5);
    expect(result.projectiles?.[0]?.y).toBeCloseTo(20, 5);
  });

  it('총구 오프셋은 조준 방향을 따라간다', () => {
    const up = resolveFire({ playerId: 'p1', weaponId: 'handgun', x: 0, y: 0, aimAngle: -Math.PI / 2 });

    expect(up.projectiles?.[0]?.x).toBeCloseTo(0, 5);
    expect(up.projectiles?.[0]?.y).toBeCloseTo(-weaponsData.handgun.muzzleOffset!, 5);
    expect(up.projectiles?.[0]?.angle).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('총구까지 밀어낸 만큼 사거리가 줄어 총 비행거리가 무기의 maxRange와 같다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'handgun', x: 0, y: 0, aimAngle: 0 });

    // 발사 지점(muzzleOffset)에서 남은 사거리를 더하면 항상 그 무기의 maxRange다.
    const projectile = result.projectiles![0]!;
    expect(projectile.x + projectile.remainingRange).toBeCloseTo(weaponsData.handgun.maxRange!, 5);
  });

  it('산탄 무기는 한 번 쏘면 펠릿 수만큼 부채꼴로 퍼진다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'pump_shotgun', x: 0, y: 0, aimAngle: 0 });
    const weapon = weaponsData.pump_shotgun;

    expect(result.projectiles).toHaveLength(weapon.pellets!);
    // 데미지는 펠릿 1개 기준이다 — 전부 맞아야 표기 위력이 나온다.
    for (const pellet of result.projectiles!) expect(pellet.damage).toBe(weapon.damage);

    const spread = (weapon.spreadDeg! * Math.PI) / 180;
    const angles = result.projectiles!.map((pellet) => pellet.angle);
    expect(Math.min(...angles)).toBeCloseTo(-spread / 2, 5);
    expect(Math.max(...angles)).toBeCloseTo(spread / 2, 5);
  });

  it('관통 무기의 투사체는 pierceRemaining과 명중 기록을 들고 나간다', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'sniper_rifle', x: 0, y: 0, aimAngle: 0 });

    expect(result.projectiles![0]!.pierceRemaining).toBe(weaponsData.sniper_rifle.pierceCount);
    expect(result.projectiles![0]!.hitIds?.size).toBe(0);
  });

  it('관통이 없는 무기의 투사체는 pierceRemaining이 0이고 hitIds가 없다', () => {
    // minigun은 pierceCount가 없다(docs/backend/68 — 이미 연사·장탄으로 무리 대응이 되는
    // 무기라 관통을 제외했다).
    expect(weaponsData.minigun.pierceCount).toBeUndefined();
    const result = resolveFire({ playerId: 'p1', weaponId: 'minigun', x: 0, y: 0, aimAngle: 0 });

    expect(result.projectiles![0]!.pierceRemaining).toBe(0);
    expect(result.projectiles![0]!.hitIds).toBeUndefined();
  });

  it('존재하지 않는 무기 id는 빈 결과를 반환한다(클라이언트 입력 불신)', () => {
    const result = resolveFire({ playerId: 'p1', weaponId: 'not-a-weapon', x: 0, y: 0, aimAngle: 0 });
    expect(result).toEqual({});
  });
});

describe('angleDifference', () => {
  it('한 바퀴를 접어서 실제 벌어진 각을 구한다', () => {
    // 179도와 -179도는 358도가 아니라 2도 차이다
    expect(angleDifference(Math.PI * 0.994, -Math.PI * 0.994)).toBeCloseTo(Math.PI * 0.012, 5);
  });

  it('방향이 반대면 π를 넘지 않는다', () => {
    expect(angleDifference(0, Math.PI)).toBeCloseTo(Math.PI, 5);
  });

  it('음수 각도도 동일하게 처리한다', () => {
    expect(angleDifference(-0.5, 0.5)).toBeCloseTo(1, 5);
  });
});

describe('withinMeleeArc', () => {
  /** 원점에서 +x를 보고 range 24 / 부채꼴 100도(절반 50도)로 휘두른 상태 */
  const swing: MeleeHit = {
    ownerId: 'p1',
    originX: 0,
    originY: 0,
    range: 24,
    aimAngle: 0,
    halfArc: (50 * Math.PI) / 180,
    damage: 10,
  };

  it('사거리 안 + 정면이면 맞는다', () => {
    expect(withinMeleeArc(swing, 20, 0, 0)).toBe(true);
  });

  it('방향은 맞아도 사거리 밖이면 빗나간다', () => {
    expect(withinMeleeArc(swing, 60, 0, 0)).toBe(false);
  });

  it('사거리 안이어도 등 뒤면 빗나간다', () => {
    expect(withinMeleeArc(swing, -20, 0, 0)).toBe(false);
  });

  it('부채꼴 경계 바로 바깥은 빗나간다', () => {
    const angle = (60 * Math.PI) / 180; // 절반 각도 50도 + 여유
    expect(withinMeleeArc(swing, Math.cos(angle) * 20, Math.sin(angle) * 20, 0)).toBe(false);
  });

  it('히트박스가 크면 중심이 부채꼴 밖이어도 걸친 만큼 맞는다', () => {
    const angle = (60 * Math.PI) / 180;
    const x = Math.cos(angle) * 20;
    const y = Math.sin(angle) * 20;
    expect(withinMeleeArc(swing, x, y, 0)).toBe(false);
    expect(withinMeleeArc(swing, x, y, 8)).toBe(true);
  });

  it('몸이 겹칠 만큼 붙으면 등 뒤라도 맞는다(밀착 사각지대 방지)', () => {
    expect(withinMeleeArc(swing, -6, 0, 10)).toBe(true);
  });

  it('halfArc가 FULL_ARC면 방향을 가리지 않는다(기존 원형 판정)', () => {
    const circular: MeleeHit = { ...swing, halfArc: FULL_ARC };
    expect(withinMeleeArc(circular, -20, 0, 0)).toBe(true);
    expect(withinMeleeArc(circular, -60, 0, 0)).toBe(false);
  });
});

describe('WeaponCooldowns', () => {
  it('처음 발사는 항상 허용한다', () => {
    const cooldowns = new WeaponCooldowns();
    expect(cooldowns.canFire('p1', 'handgun', 0)).toBe(true);
  });

  it('fireRate 간격 전에는 다시 발사할 수 없다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'handgun', 0); // fireRate 5 → 0.2초 간격
    expect(cooldowns.canFire('p1', 'handgun', 0.1)).toBe(false);
    expect(cooldowns.canFire('p1', 'handgun', 0.2)).toBe(true);
  });

  it('플레이어별로 독립적으로 추적한다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'handgun', 0);
    expect(cooldowns.canFire('p2', 'handgun', 0)).toBe(true);
  });

  it('removePlayer 이후에는 다시 처음 발사로 취급한다', () => {
    const cooldowns = new WeaponCooldowns();
    cooldowns.recordFire('p1', 'handgun', 0);
    cooldowns.removePlayer('p1');
    expect(cooldowns.canFire('p1', 'handgun', 0.01)).toBe(true);
  });
});

describe('tickProjectiles', () => {
  it('속도에 비례해 이동한다', () => {
    const projectiles = new Map<string, ProjectileEntity>([
      ['a', { id: 'a', ownerId: 'p1', x: 0, y: 0, vx: 100, vy: 0, angle: 0, damage: 1, remainingRange: 600 }],
    ]);
    tickProjectiles(projectiles, 1);
    expect(projectiles.get('a')?.x).toBe(100);
  });

  it('사거리를 다 쓰면 제거된다', () => {
    const projectiles = new Map<string, ProjectileEntity>([
      ['a', { id: 'a', ownerId: 'p1', x: 0, y: 0, vx: 1000, vy: 0, angle: 0, damage: 1, remainingRange: 10 }],
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
