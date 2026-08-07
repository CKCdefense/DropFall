import { describe, expect, it } from 'vitest';
import { World, type MonsterEntity } from '../src/sim/world';
import { monstersData, wavesData } from '../src/data';

const MELEE = monstersData.boss_demon.meleeAttacks!;
/** 기술의 도달 거리 = 타격들 중 가장 먼 사거리. 후보 판정도 이 값으로 한다. */
const reachOf = (attack: { hits: { range: number }[] }): number =>
  Math.max(...attack.hits.map((h) => h.range));
const THRUST = MELEE[0]!; // Attack01 찌르기 — 멀지만 좁다
const CHOP = MELEE[1]!; // Attack02 내려치기 — 짧고 중간 각도
const SWEEP = MELEE[2]!; // Attack03 양손 베기 — 가장 멀고 가장 넓다

/**
 * 2일차 보스를 개발 커맨드로 바로 세운다. 웨이브를 태우면 잡몹을 전멸시켜야 나오는데,
 * 검술 판정만 보는 이 파일에서는 스폰 경로가 검증 대상이 아니다(wave.test.ts가 본다).
 */
function spawnBoss(world: World): MonsterEntity {
  world.addPlayer('dev', 3000, 3000); // 아그로 밖 — 커맨드 실행용
  const result = world.runDevCommand('dev', 'spawn boss_demon 1');
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_demon');
  if (!boss) throw new Error('보스가 스폰되지 않았다');
  // 무대를 고정한다: 코어에서 +x로 떨어진 자리에서 코어(-x)를 향해 진군하는 상태.
  // 플레이어는 그 진행 방향 앞(코어 쪽)에 서서 막는 게 실제 상황이고, 시야각
  // 판정(AGGRO_FOV)도 이 배치여야 통과한다 — 등 뒤에 세우면 아예 인식하지 않는다.
  boss.x = 400;
  boss.y = 0;
  boss.facingX = -1;
  boss.facingY = 0;
  return boss;
}

/** 보스 정면(코어 쪽)으로 distance만큼 떨어진 곳에 플레이어를 세운다. */
function addPlayerInFront(world: World, boss: MonsterEntity, distance: number): string {
  world.addPlayer('p1', boss.x - distance, boss.y);
  return 'p1';
}

/** 보스가 검술을 시작할 때까지 틱한다(첫 패턴 유예 3초를 넘겨야 한다). */
function tickUntilWindup(world: World, boss: MonsterEntity, seconds = 6): void {
  for (let i = 0; i < seconds * 20 && boss.pattern.kind !== 'meleeSwing'; i += 1) {
    world.tick(0.05);
  }
}

describe('World — 2일차 보스(쌍검) 검술', () => {
  it('사거리 안에 들어오면 검술 예고를 시작하고, 예고 중에는 제자리에 멈춘다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    // 가장 짧은 기술(내려치기)도 닿는 거리에 세운다.
    addPlayerInFront(world, boss, reachOf(CHOP) - 10);

    tickUntilWindup(world, boss);

    expect(boss.pattern.kind).toBe('meleeSwing');
    const x = boss.x;
    const y = boss.y;
    world.tick(0.05);
    expect(boss.x).toBe(x); // 칼을 치켜드는 동안은 안 움직인다
    expect(boss.y).toBe(y);
  });

  it('예고가 끝나면 부채꼴 안의 플레이어가 그 기술의 피해를 입고, 보스는 경직에 들어간다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    // 바로 앞(정면)에 세운다 — 어떤 기술이 나와도 부채꼴 안이다.
    addPlayerInFront(world, boss, 40);
    const player = world.getPlayers().get('p1')!;

    tickUntilWindup(world, boss);
    const attack = MELEE[(boss.pattern as { index: number }).index]!;
    const hpBefore = player.hp;
    const totalDamage = attack.hits.reduce((sum, h) => sum + h.damage, 0);

    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.05);

    expect(player.hp).toBe(hpBefore - totalDamage);
    expect(boss.pattern.kind).toBe('meleeRecover');
  });

  it('예고 방향에서 옆으로 벗어나면 좁은 기술(찌르기)은 빗나간다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    addPlayerInFront(world, boss, 60);
    const player = world.getPlayers().get('p1')!;

    tickUntilWindup(world, boss);
    const attack = MELEE[(boss.pattern as { index: number }).index]!;
    // 예고는 시작 시점 방향(-x)에 고정돼 있다. 그 방향에서 거의 90도 옆으로 빠지면
    // 가장 넓은 기술(140도 → 절반 70도)의 부채꼴에서도 벗어난다.
    player.x = boss.x - 20;
    player.y = boss.y + reachOf(attack);
    const hpBefore = player.hp;

    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.05);

    // 90도는 가장 넓은 기술(140도 → 절반 70도)의 부채꼴에서도 벗어난다.
    expect(player.hp).toBe(hpBefore);
  });

  it('기술 쿨다운은 따로 돈다 — 한 번 쓴 기술은 곧바로 다시 나오지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    addPlayerInFront(world, boss, 40);

    tickUntilWindup(world, boss);
    const first = (boss.pattern as { index: number }).index;
    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.05);

    expect(boss.meleeCooldowns[first]).toBeGreaterThan(0);
    // 나머지 기술은 여전히 준비 상태다(전부 같이 도는 게 아니다).
    const others = boss.meleeCooldowns.filter((_, i) => i !== first);
    expect(others.every((cd) => cd === 0)).toBe(true);
  });

  it('가장 긴 기술의 사거리 밖에서는 검술을 시작하지 않고 평소처럼 접근한다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    // 아그로(320)에는 들지만 가장 긴 검술(117)보다는 훨씬 멀다.
    addPlayerInFront(world, boss, 260);
    const startDistance = 260;

    for (let i = 0; i < 60; i += 1) world.tick(0.05);

    expect(boss.pattern.kind).not.toBe('meleeSwing');
    const player = world.getPlayers().get('p1')!;
    expect(Math.hypot(player.x - boss.x, player.y - boss.y)).toBeLessThan(startDistance);
  });

  it('보스 그림이 3배가 된 만큼 피격 반경도 커져 있다(보이는 크기 = 맞는 범위)', () => {
    // 렌더 배율(monsterSprite.ts의 SCALE)과 짝을 이루는 값이라, 한쪽만 바뀌면
    // "검이 닿아 보이는데 안 맞는다"가 된다. 여기서 최소한의 하한을 고정해 둔다.
    expect(monstersData.boss_demon.hitRadius).toBeGreaterThanOrEqual(36);
    expect(reachOf(SWEEP)).toBeGreaterThan(reachOf(THRUST));
    expect(reachOf(THRUST)).toBeGreaterThan(reachOf(CHOP));
  });

  it('거구 보스는 자원 노드를 밟고 지나간다 — 나무에 걸려 멈추지 않는다', () => {
    // 회귀: 반경이 40으로 커지자 16px 격자로 우회로를 찾는 FlowField가 들어갈 수 없는
    // 틈으로 보스를 보내서, 코어 458px 앞 나무에 걸려 2초간 갈리는 상황이 실측됐다.
    // crushesObstacles로 통과시키면 사라진다.
    expect(monstersData.boss_demon.crushesObstacles).toBe(true);

    const world = new World();
    const boss = spawnBoss(world);
    world.getPlayers().get('dev')!.x = 5000; // 아그로 밖 — 순수 이동만 본다

    // 진행 방향 바로 앞에 나무를 옮겨다 놓는다(무작위 배치에 기대지 않는다).
    const [node] = [...world.getResourceNodes().values()];
    node!.x = boss.x - 60;
    node!.y = boss.y;

    const startDistance = Math.hypot(boss.x, boss.y);
    for (let i = 0; i < 200; i += 1) world.tick(0.05);

    // 10초면 speed 45로 450px를 간다 — 나무에 걸렸다면 60px 앞에서 멈췄을 것이다.
    expect(Math.hypot(boss.x, boss.y)).toBeLessThan(startDistance - 200);
  });

  it('보스가 살아있는 동안은 밤이 끝나지 않는다(레이드 게이트 회귀)', () => {
    const world = new World();
    const boss = spawnBoss(world);
    world.tick(wavesData.dayDuration); // 밤 진입
    expect(world.getMonsters().has(boss.id)).toBe(true);
  });
});

// ---------------------------------------------------------------- 3일차 흑기사

const KNIGHT = monstersData.boss_knight.meleeAttacks!;
const COMBO = KNIGHT[0]!; // Attack01 — 내려베기 + 찌르기 2연타
const PIERCE = KNIGHT[1]!; // Attack02 — 회전 후 최장거리 찌르기
const SLAM = KNIGHT[2]!; // Attack03 — 점프 후 착지 가시(전방향)

function spawnKnight(world: World): MonsterEntity {
  world.addPlayer('dev', 3000, 3000);
  const result = world.runDevCommand('dev', 'spawn boss_knight 1');
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_knight')!;
  boss.x = 400;
  boss.y = 0;
  boss.facingX = -1;
  boss.facingY = 0;
  return boss;
}

/** 특정 기술이 나올 때까지 반복해서 상황을 만든다(기술 선택이 무작위라 시드를 못 고정한다). */
function forceAttack(world: World, boss: MonsterEntity, animIndex: number): void {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    world.tick(0.05);
    if (boss.pattern.kind === 'meleeSwing') {
      if ((boss.pattern as { index: number }).index === animIndex) return;
      // 원하는 기술이 아니면 쿨다운을 태워 다음 기회를 만든다.
      boss.pattern = { kind: 'idle' };
      boss.meleeCooldowns[(boss.pattern as unknown as { index?: number }).index ?? 0] = 0;
      boss.meleeCooldowns[animIndex] = 0;
    }
    boss.x = 400;
    boss.y = 0;
  }
  throw new Error(`기술 ${animIndex}가 나오지 않았다`);
}

describe('World — 3일차 보스(흑기사) 창술', () => {
  it('1번 기술은 한 동작에 두 번 때린다 — 각 타격이 따로 들어간다', () => {
    expect(COMBO.hits).toHaveLength(2);
    // 내려베기가 먼저, 찌르기가 나중. 찌르기가 더 멀리 더 좁게 나간다.
    expect(COMBO.hits[0]!.atSeconds).toBeLessThan(COMBO.hits[1]!.atSeconds);
    expect(COMBO.hits[1]!.range).toBeGreaterThan(COMBO.hits[0]!.range);
    expect(COMBO.hits[1]!.arc).toBeLessThan(COMBO.hits[0]!.arc);

    const world = new World();
    const boss = spawnKnight(world);
    world.addPlayer('p1', boss.x - 40, boss.y);
    const player = world.getPlayers().get('p1')!;
    forceAttack(world, boss, 0);

    const hpBefore = player.hp;
    // 첫 타격 시점만 넘기고 멈춰서, 아직 두 번째가 안 들어왔는지 본다.
    for (let i = 0; i < 40; i += 1) {
      world.tick(0.02);
      const p = boss.pattern;
      if (p.kind === 'meleeSwing' && p.nextHit === 1) break;
    }
    expect(player.hp).toBe(hpBefore - COMBO.hits[0]!.damage);

    // 끝까지 진행하면 두 번째 타격까지 들어간다.
    for (let i = 0; i < 80 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.02);
    expect(player.hp).toBe(hpBefore - COMBO.hits[0]!.damage - COMBO.hits[1]!.damage);
  });

  it('3번 기술(착지 가시)은 전방향이라 등 뒤로 돌아도 맞는다', () => {
    expect(SLAM.hits[0]!.arc).toBe(360);

    const world = new World();
    const boss = spawnKnight(world);
    world.addPlayer('p1', boss.x - 40, boss.y);
    const player = world.getPlayers().get('p1')!;
    forceAttack(world, boss, 2);

    // 예고 방향(-x)의 정반대, 즉 완전히 등 뒤로 돌아간다.
    player.x = boss.x + 60;
    player.y = boss.y;
    const hpBefore = player.hp;

    for (let i = 0; i < 80 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.02);

    expect(player.hp).toBe(hpBefore - SLAM.hits[0]!.damage);
  });

  it('2번 기술은 가장 멀리 닿지만 가장 좁다', () => {
    const reaches = KNIGHT.map(reachOf);
    expect(Math.max(...reaches)).toBe(reachOf(PIERCE));
    expect(PIERCE.hits[0]!.arc).toBeLessThanOrEqual(COMBO.hits[1]!.arc);
  });

  it('흑기사도 3배 크기에 맞춰 피격 반경이 커져 있고 장애물을 밟고 지나간다', () => {
    expect(monstersData.boss_knight.hitRadius).toBeGreaterThanOrEqual(24);
    expect(monstersData.boss_knight.crushesObstacles).toBe(true);
  });
});
