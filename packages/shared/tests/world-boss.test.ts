import { describe, expect, it } from 'vitest';
import { World, describeBossTelegraph, type MonsterEntity } from '../src/sim/world';
import { monstersData } from '../src/data';

/**
 * 보스 공격 예고(텔레그래프) 표시.
 *
 * 예전에는 돌진(charge)/광역(slam)이라는 별도 패턴이 예고를 만들었는데, 보스 넷이
 * 전부 스프라이트 기반 검술로 바뀌면서 그 두 패턴은 사라졌다(돌진은 meleeAttacks의
 * `dash`, 광역은 `arc: 360`이 대신한다). 예고는 이제 **진행 중인 검술의 다음 타격**을
 * 설명한다 — 클라이언트 렌더러는 그대로 두고(원/방향 띠 두 모양) 그 입력만 바꿨다.
 */

const DEMON = monstersData.boss_demon;
const GOLEM = monstersData.boss_golem;

function spawnBoss(world: World, type: string): MonsterEntity {
  world.addPlayer('dev', 3000, 3000);
  const result = world.runDevCommand('dev', `spawn ${type} 1`);
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === type)!;
  boss.x = 400;
  boss.y = 0;
  boss.facingX = -1;
  boss.facingY = 0;
  return boss;
}

/** 원하는 기술만 쿨다운을 열어 유도한다(선택이 무작위라 시드를 못 고정한다). */
function forceAttack(world: World, boss: MonsterEntity, index: number): void {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    boss.meleeCooldowns.forEach((_, i) => {
      boss.meleeCooldowns[i] = i === index ? 0 : 99;
    });
    for (const p of world.getPlayers().values()) p.hp = 500;
    world.tick(0.05);
    if (boss.pattern.kind === 'meleeSwing' && (boss.pattern as { index: number }).index === index) {
      return;
    }
    if (boss.pattern.kind === 'idle') {
      boss.x = 400;
      boss.y = 0;
    }
  }
  throw new Error(`기술 ${index}가 나오지 않았다`);
}

describe('World — 보스 공격 예고', () => {
  it('검술 중이 아니면 예고가 없다', () => {
    const world = new World();
    const boss = spawnBoss(world, 'boss_demon');

    expect(boss.pattern.kind).toBe('idle');
    expect(describeBossTelegraph(boss, DEMON)).toBeUndefined();
  });

  it('부채꼴 기술은 방향 띠로, 전방향 기술은 원으로 설명된다', () => {
    // 클라이언트는 이 두 모양만 그릴 줄 안다 — 어떤 기술이든 둘 중 하나로 번역된다.
    const world = new World();
    const boss = spawnBoss(world, 'boss_demon');
    world.addPlayer('p1', boss.x - 60, boss.y);

    forceAttack(world, boss, 0); // 데몬 1번 = 찌르기(40도)
    const cone = describeBossTelegraph(boss, DEMON)!;
    expect(cone.kind).toBe('charge');
    expect(cone.range).toBe(DEMON.meleeAttacks![0]!.hits[0]!.range);
    expect(cone.dirX).toBeCloseTo(-1, 5); // 예고 시작 시점 방향(코어 쪽)으로 고정
    expect(cone.radius).toBeGreaterThan(0);
    expect(cone.radius).toBeLessThan(cone.range); // 좁은 기술이라 띠 반폭 < 사거리

    const world2 = new World();
    const golem = spawnBoss(world2, 'boss_golem');
    world2.addPlayer('p1', golem.x - 60, golem.y);

    forceAttack(world2, golem, 1); // 골렘 2번 = 광역 찍기(360도)
    const circle = describeBossTelegraph(golem, GOLEM)!;
    expect(circle.kind).toBe('slam');
    expect(circle.radius).toBe(GOLEM.meleeAttacks![1]!.hits[0]!.range);
    // 원은 보스 자신을 중심으로 그린다.
    expect(circle.x).toBe(golem.x);
    expect(circle.y).toBe(golem.y);
  });

  it('예고 진행률은 타격이 임박할수록 0에 가까워진다', () => {
    const world = new World();
    const boss = spawnBoss(world, 'boss_demon');
    world.addPlayer('p1', boss.x - 60, boss.y);

    forceAttack(world, boss, 0);
    const first = describeBossTelegraph(boss, DEMON)!;
    world.tick(0.1);
    const later = describeBossTelegraph(boss, DEMON)!;

    expect(later.remaining).toBeLessThan(first.remaining);
    expect(later.total).toBe(first.total); // 전체 길이는 안 변한다
    expect(first.remaining).toBeLessThanOrEqual(first.total);
  });

  it('2연타는 첫 타격이 끝나면 두 번째 타격의 예고로 갱신된다', () => {
    // 흑기사 1번은 내려베기 → 찌르기다. 두 번째 예고가 처음부터 꽉 찬 상태로 뜨지
    // 않도록, 진행률을 "직전 타격부터" 재는지 확인한다.
    const world = new World();
    const boss = spawnBoss(world, 'boss_knight');
    const data = monstersData.boss_knight;
    world.addPlayer('p1', boss.x - 40, boss.y);

    forceAttack(world, boss, 0);
    const firstHit = describeBossTelegraph(boss, data)!;
    expect(firstHit.range).toBe(data.meleeAttacks![0]!.hits[0]!.range);

    // 첫 타격이 들어갈 때까지 진행.
    for (let i = 0; i < 300; i += 1) {
      const p = boss.pattern;
      if (p.kind !== 'meleeSwing' || p.nextHit >= 1) break;
      world.tick(0.01);
    }

    const secondHit = describeBossTelegraph(boss, data)!;
    expect(secondHit.range).toBe(data.meleeAttacks![0]!.hits[1]!.range);
    // 두 번째 예고의 전체 길이는 "첫 타격 → 두 번째 타격" 간격이다.
    const gap =
      data.meleeAttacks![0]!.hits[1]!.atSeconds - data.meleeAttacks![0]!.hits[0]!.atSeconds;
    expect(secondHit.total).toBeCloseTo(gap, 3);
    expect(secondHit.remaining).toBeLessThanOrEqual(secondHit.total);
  });

  it('경직 중에는 예고가 사라진다 — 다 끝난 기술을 계속 보여주지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world, 'boss_demon');
    world.addPlayer('p1', boss.x - 60, boss.y);

    forceAttack(world, boss, 0);
    for (let i = 0; i < 300 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.01);

    expect(boss.pattern.kind).toBe('meleeRecover');
    expect(describeBossTelegraph(boss, DEMON)).toBeUndefined();
  });
});
