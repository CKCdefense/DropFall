import { describe, expect, it } from 'vitest';
import { World, type MonsterEntity } from '../src/sim/world';
import { monstersData, wavesData } from '../src/data';

const MELEE = monstersData.boss_demon.meleeAttacks!;
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
  for (let i = 0; i < seconds * 20 && boss.pattern.kind !== 'meleeWindup'; i += 1) {
    world.tick(0.05);
  }
}

describe('World — 2일차 보스(쌍검) 검술', () => {
  it('사거리 안에 들어오면 검술 예고를 시작하고, 예고 중에는 제자리에 멈춘다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    // 가장 짧은 기술(내려치기)도 닿는 거리에 세운다.
    addPlayerInFront(world, boss, CHOP.range - 10);

    tickUntilWindup(world, boss);

    expect(boss.pattern.kind).toBe('meleeWindup');
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

    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeWindup'; i += 1) world.tick(0.05);

    expect(player.hp).toBe(hpBefore - attack.damage);
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
    player.y = boss.y + attack.range;
    const hpBefore = player.hp;

    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeWindup'; i += 1) world.tick(0.05);

    // 90도는 가장 넓은 기술(140도 → 절반 70도)의 부채꼴에서도 벗어난다.
    expect(player.hp).toBe(hpBefore);
  });

  it('기술 쿨다운은 따로 돈다 — 한 번 쓴 기술은 곧바로 다시 나오지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    addPlayerInFront(world, boss, 40);

    tickUntilWindup(world, boss);
    const first = (boss.pattern as { index: number }).index;
    for (let i = 0; i < 60 && boss.pattern.kind === 'meleeWindup'; i += 1) world.tick(0.05);

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

    expect(boss.pattern.kind).not.toBe('meleeWindup');
    const player = world.getPlayers().get('p1')!;
    expect(Math.hypot(player.x - boss.x, player.y - boss.y)).toBeLessThan(startDistance);
  });

  it('보스 그림이 3배가 된 만큼 피격 반경도 커져 있다(보이는 크기 = 맞는 범위)', () => {
    // 렌더 배율(monsterSprite.ts의 SCALE)과 짝을 이루는 값이라, 한쪽만 바뀌면
    // "검이 닿아 보이는데 안 맞는다"가 된다. 여기서 최소한의 하한을 고정해 둔다.
    expect(monstersData.boss_demon.hitRadius).toBeGreaterThanOrEqual(36);
    expect(SWEEP.range).toBeGreaterThan(THRUST.range);
    expect(THRUST.range).toBeGreaterThan(CHOP.range);
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
