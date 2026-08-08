import { describe, expect, it } from 'vitest';
import { World, describeBossTelegraph, type MonsterEntity } from '../src/sim/world';
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

  it('보스는 잡몹보다 훨씬 큰 피격 반경을 갖는다(보이는 크기 = 맞는 범위)', () => {
    // 렌더 배율(monsterSprite.ts의 SCALE)과 짝을 이루는 값이라, 한쪽만 바뀌면
    // "검이 닿아 보이는데 안 맞는다"가 된다. 배율은 밸런스에 따라 조정되므로
    // 절대값이 아니라 "엘리트(미노타우르스)보다 확실히 크다"로 고정한다.
    expect(monstersData.boss_demon.hitRadius).toBeGreaterThan(monstersData.minotaur.hitRadius * 2);
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

  it('공격 모션은 타격이 아니라 **동작 시작**에 켜진다 — 예고를 보고 피할 수 있어야 한다', () => {
    // 회귀: 예전에는 피해가 들어가는 순간 모션을 켜서, 예고 내내 보스가 가만히 서
    // 있다가 맞은 뒤에 칼을 휘둘렀다(실측 모션 지연 667ms = 피해 지연 667ms).
    const world = new World();
    const boss = spawnBoss(world);
    world.addPlayer('p1', boss.x - 40, boss.y);
    const player = world.getPlayers().get('p1')!;
    player.hp = 500;

    tickUntilWindup(world, boss);

    // 아직 아무 타격도 안 들어간 시점인데 모션은 이미 켜져 있어야 한다.
    expect((boss.pattern as { nextHit: number }).nextHit).toBe(0);
    expect(boss.attackAnimTimer).toBeGreaterThan(0);
    const attack = MELEE[(boss.pattern as { index: number }).index]!;
    expect(boss.attackAnim).toBe(attack.anim);

    // 모션이 켜진 뒤 실제 피해까지는 그 기술의 타격 시점만큼 여유가 있다.
    const hpAtStart = player.hp;
    const elapsedAtStart = (boss.pattern as { elapsed: number }).elapsed;
    expect(elapsedAtStart).toBeLessThan(attack.hits[0]!.atSeconds);
    expect(player.hp).toBe(hpAtStart);
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
    // 체력은 초당 조금씩 자연 회복하므로(HP_REGEN) 정수로 딱 떨어지지 않는다 —
    // 이 테스트가 보는 건 "몇 번째 타격까지 들어갔나"라 1 미만 오차는 무시한다.
    expect(player.hp).toBeCloseTo(hpBefore - COMBO.hits[0]!.damage, 0);

    // 끝까지 진행하면 두 번째 타격까지 들어간다.
    for (let i = 0; i < 80 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.02);
    expect(player.hp).toBeCloseTo(hpBefore - COMBO.hits[0]!.damage - COMBO.hits[1]!.damage, 0);
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

  it('흑기사도 커진 체급에 맞춰 피격 반경이 크고 장애물을 밟고 지나간다', () => {
    expect(monstersData.boss_knight.hitRadius).toBeGreaterThan(monstersData.minotaur.hitRadius);
    expect(monstersData.boss_knight.crushesObstacles).toBe(true);
  });
});

// ---------------------------------------------------------------- 4일차 화염 골렘

const GOLEM = monstersData.boss_golem.meleeAttacks!;
const JAB = GOLEM[0]!; // Attack01 — 가장 자주 나오는 짧은 패턴
const STOMP = GOLEM[1]!; // Attack02 — 광역 찍기(전방향)
const RUSH = GOLEM[2]!; // Attack03 — 긴 직선 돌격 + 마무리 광역

function spawnGolem(world: World): MonsterEntity {
  world.addPlayer('dev', 3000, 3000);
  const result = world.runDevCommand('dev', 'spawn boss_golem 1');
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_golem')!;
  boss.x = 400;
  boss.y = 0;
  boss.facingX = -1;
  boss.facingY = 0;
  return boss;
}

/**
 * 원하는 기술이 나올 때까지 다른 기술의 쿨다운을 태워 유도한다. 기술 선택은
 * 무작위라 시드를 고정할 수 없어서, 나오지 않은 기술만 준비 상태로 남긴다.
 */
function forceGolemAttack(world: World, boss: MonsterEntity, index: number): void {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    // 원하는 것만 쿨다운 0, 나머지는 막아 둔다.
    boss.meleeCooldowns.forEach((_, i) => {
      boss.meleeCooldowns[i] = i === index ? 0 : 99;
    });
    // 기술이 나올 때까지 기다리는 동안 평타를 맞는다. 체력이 0에 붙으면 이후 피해
    // 측정이 뭉개지므로(clamp) 매번 되돌려 둔다 — 이 단계는 측정 대상이 아니다.
    for (const p of world.getPlayers().values()) p.hp = 100;
    world.tick(0.05);
    if (boss.pattern.kind === 'meleeSwing' && (boss.pattern as { index: number }).index === index) {
      return;
    }
    if (boss.pattern.kind === 'idle') {
      boss.x = 400;
      boss.y = 0;
    }
  }
  throw new Error(`골렘 기술 ${index}가 나오지 않았다`);
}

describe('World — 4일차 보스(화염 골렘)', () => {
  it('1번은 셋 중 가장 짧고, 광역 찍기와 돌격 마무리는 전방향이라 옆으로 못 피한다', () => {
    expect(reachOf(JAB)).toBeLessThan(reachOf(STOMP));
    expect(JAB.hits[0]!.arc).toBeLessThan(360);
    expect(STOMP.hits[0]!.arc).toBe(360);
    expect(RUSH.hits[0]!.arc).toBe(360);
    // 돌진만 이동을 동반한다.
    expect(JAB.dash).toBeUndefined();
    expect(STOMP.dash).toBeUndefined();
    expect(RUSH.dash).toBeDefined();
  });

  it('돌격은 원이 아니라 길고 좁은 직사각형이다 — 옆으로 비키면 피할 수 있다', () => {
    const dash = RUSH.dash!;
    const travel = dash.speed * (dash.toSeconds - dash.fromSeconds);

    // 판정 폭(좌우)이 돌진 길이보다 훨씬 좁아야 "통로"가 된다. 원 판정이면 폭이 곧
    // 반지름이라 이 관계가 성립할 수 없다.
    expect(dash.halfWidth).toBeDefined();
    expect(dash.radius).toBeUndefined();
    expect(travel).toBeGreaterThan(dash.halfWidth! * 3);
  });

  it('돌격 예고는 마무리 원이 아니라 지나갈 통로를 보여준다', () => {
    const world = new World();
    const boss = spawnGolem(world);
    world.addPlayer('p1', boss.x - 150, boss.y);

    forceGolemAttack(world, boss, 2);
    const telegraph = describeBossTelegraph(boss, monstersData.boss_golem)!;

    // 예고와 판정이 다르면 피할 방법이 없다 — 띠의 길이·폭이 돌진 데이터와 같아야 한다.
    const dash = RUSH.dash!;
    expect(telegraph.kind).toBe('charge');
    expect(telegraph.radius).toBe(dash.halfWidth);
    expect(telegraph.range).toBeCloseTo(dash.speed * (dash.toSeconds - dash.fromSeconds), 5);
  });

  it('돌격 경로 옆에 비켜서 있으면 맞지 않고, 경로 위에 있으면 맞는다', () => {
    // 경로 위 — 정면에 서 있으면 쓸린다.
    const onPath = new World();
    const bossOn = spawnGolem(onPath);
    onPath.addPlayer('p1', bossOn.x - 150, bossOn.y);
    const hit = onPath.getPlayers().get('p1')!;
    forceGolemAttack(onPath, bossOn, 2);
    hit.hp = 500; // 기술이 시작된 뒤에 기준을 잡는다 — 유도 단계의 피해는 측정 대상이 아니다
    for (let i = 0; i < 300 && bossOn.pattern.kind === 'meleeSwing'; i += 1) onPath.tick(0.01);
    expect(hit.hp).toBeLessThan(500);

    // 경로 옆 — 같은 거리지만 통로 폭 밖으로 비켜서면 안 맞는다. 마무리 광역(전방향
    // 110px)까지 벗어나야 "돌격을 피했다"가 성립하므로 그만큼 넉넉히 비켜선다.
    const beside = new World();
    const bossBeside = spawnGolem(beside);
    const side = RUSH.dash!.halfWidth! + RUSH.hits[0]!.range;
    beside.addPlayer('p1', bossBeside.x - 150, bossBeside.y + side);
    const dodged = beside.getPlayers().get('p1')!;
    forceGolemAttack(beside, bossBeside, 2);
    dodged.hp = 500;
    for (let i = 0; i < 300 && bossBeside.pattern.kind === 'meleeSwing'; i += 1) {
      beside.tick(0.01);
      dodged.y = bossBeside.y + side; // 밀려나지 않게 옆자리를 유지한다
    }
    expect(dodged.hp).toBe(500);
  });

  it('3번 기술은 실제로 앞으로 돌진한다 — 제자리 기술과 달리 위치가 바뀐다', () => {
    const world = new World();
    const boss = spawnGolem(world);
    // 돌진은 "사거리 + 돌진으로 좁히는 거리"까지가 후보 범위다. 배율이 바뀌면 그
    // 값도 바뀌므로 하드코딩하지 않고 데이터에서 계산한다.
    const dashTravel = RUSH.dash!.speed * (RUSH.dash!.toSeconds - RUSH.dash!.fromSeconds);
    world.addPlayer('p1', boss.x - (reachOf(RUSH) + dashTravel) * 0.85, boss.y);

    forceGolemAttack(world, boss, 2);
    const startX = boss.x;
    for (let i = 0; i < 80 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.02);

    // 돌진 창(dash.fromSeconds~toSeconds) × 속도만큼 앞으로(코어 쪽 = -x) 나아간다.
    // 배율이 바뀌면 절대값도 따라 바뀌므로 데이터에서 기대 이동량을 계산한다.
    expect(boss.x).toBeLessThan(startX - dashTravel * 0.5);
  });

  it('돌진에 쓸린 대상은 한 번만 맞는다 — 가만히 서 있어도 중복 피해가 없다', () => {
    const world = new World();
    const boss = spawnGolem(world);
    world.addPlayer('p1', boss.x - 60, boss.y); // 돌진 경로 바로 앞
    const player = world.getPlayers().get('p1')!;

    forceGolemAttack(world, boss, 2);
    player.hp = 500; // 합계를 재려면 0에 닿아 잘리면 안 된다
    const hpBefore = player.hp;

    // 돌진이 끝날 때까지 계속 몸에 붙여 둔다 — 매 틱 판정하는 구현이었다면
    // 수십 번 맞았을 상황이다.
    for (let i = 0; i < 300 && boss.pattern.kind === 'meleeSwing'; i += 1) {
      world.tick(0.01);
      player.x = boss.x - 20;
      player.y = boss.y;
    }

    // 돌진 1회 + 착지 충격 1회. 그 이상이면 중복 판정이 새고 있다는 뜻이다.
    expect(hpBefore - player.hp).toBe(RUSH.dash!.damage + RUSH.hits[0]!.damage);
  });

  it('광역 찍기는 등 뒤로 돌아가도 맞는다', () => {
    const world = new World();
    const boss = spawnGolem(world);
    world.addPlayer('p1', boss.x - 60, boss.y);
    const player = world.getPlayers().get('p1')!;

    forceGolemAttack(world, boss, 1);
    player.x = boss.x + 80; // 예고 방향(-x)의 정반대
    player.y = boss.y;
    const hpBefore = player.hp;

    for (let i = 0; i < 80 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.02);

    expect(player.hp).toBe(hpBefore - STOMP.hits[0]!.damage);
  });

  it('넷 중 가장 큰 4배 체급이라 피격 반경도 가장 크다', () => {
    // 배율(monsterSprite.ts SCALE)과 짝을 이루는 값 — 한쪽만 바뀌면 그림과 판정이 어긋난다.
    expect(monstersData.boss_golem.hitRadius).toBeGreaterThan(monstersData.boss_demon.hitRadius);
    expect(monstersData.boss_golem.hitRadius).toBeGreaterThan(monstersData.boss_knight.hitRadius);
    expect(monstersData.boss_golem.crushesObstacles).toBe(true);
  });
});

// ---------------------------------------------------------------- 5일차 심연의 흑기사

const DARK = monstersData.boss_dark_knight.meleeAttacks!;
const SLASH = DARK[0]!; // Attack01 — 크게 휘두르는 베기(최장)
const OVERHEAD = DARK[1]!; // Attack02 — 뒤로 젖혔다 내리치는 다른 모션(넓은 각)
const PLUNGE = DARK[2]!; // Attack03 — 점프 내리찍기 + 지연 화염 기둥

function spawnDark(world: World): MonsterEntity {
  world.addPlayer('dev', 3000, 3000);
  const result = world.runDevCommand('dev', 'spawn boss_dark_knight 1');
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_dark_knight')!;
  boss.x = 400;
  boss.y = 0;
  boss.facingX = -1;
  boss.facingY = 0;
  return boss;
}

/** 원하는 기술만 쿨다운을 열어 유도한다(선택이 무작위라 시드를 못 고정한다). */
function forceDarkAttack(world: World, boss: MonsterEntity, index: number): void {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    boss.meleeCooldowns.forEach((_, i) => {
      boss.meleeCooldowns[i] = i === index ? 0 : 99;
    });
    for (const p of world.getPlayers().values()) p.hp = 500; // 준비 중 평타로 죽지 않게
    world.tick(0.05);
    if (boss.pattern.kind === 'meleeSwing' && (boss.pattern as { index: number }).index === index) {
      return;
    }
    if (boss.pattern.kind === 'idle') {
      boss.x = 400;
      boss.y = 0;
    }
  }
  throw new Error(`최종 보스 기술 ${index}가 나오지 않았다`);
}

describe('World — 5일차 최종 보스(심연의 흑기사)', () => {
  it('1번과 2번은 서로 다른 성격이다 — 1번이 더 멀리, 2번이 더 넓게', () => {
    expect(reachOf(SLASH)).toBeGreaterThan(reachOf(OVERHEAD));
    expect(OVERHEAD.hits[0]!.arc).toBeGreaterThan(SLASH.hits[0]!.arc);
  });

  it('3번은 내리찍기(전방향) 뒤에 화염 기둥(앞쪽)이 따라오는 2연타다', () => {
    expect(PLUNGE.hits).toHaveLength(2);
    const [slam, beam] = PLUNGE.hits;
    // 내리찍기가 먼저 터지고, 기둥은 그보다 늦게 솟는다.
    expect(slam!.atSeconds).toBeLessThan(beam!.atSeconds);
    // 내리찍기는 전방향이라 못 피하고, 기둥은 앞쪽이라 뒤로 빠지면 피할 수 있다.
    expect(slam!.arc).toBe(360);
    expect(beam!.arc).toBeLessThan(360);
    expect(beam!.range).toBeGreaterThan(slam!.range);
    // 점프해서 앞으로 나아간다.
    expect(PLUNGE.dash).toBeDefined();
  });

  it('내리찍기를 맞아도 착지 후 뒤로 빠지면 화염 기둥은 피할 수 있다', () => {
    const world = new World();
    const boss = spawnDark(world);
    world.addPlayer('p1', boss.x - 80, boss.y);
    const player = world.getPlayers().get('p1')!;

    forceDarkAttack(world, boss, 2);
    player.hp = 500;
    const hpBefore = player.hp;

    // 첫 타격(내리찍기)까지 진행.
    for (let i = 0; i < 300; i += 1) {
      const p = boss.pattern;
      if (p.kind !== 'meleeSwing' || p.nextHit >= 1) break;
      world.tick(0.01);
    }
    const afterSlam = player.hp;
    expect(afterSlam).toBeLessThan(hpBefore); // 전방향이라 맞았다

    // 기둥이 솟기 전에 예고 방향 반대쪽(뒤)으로 크게 빠진다.
    player.x = boss.x + 260;
    player.y = boss.y;
    for (let i = 0; i < 300 && boss.pattern.kind === 'meleeSwing'; i += 1) world.tick(0.01);

    expect(player.hp).toBe(afterSlam); // 기둥은 앞쪽이라 안 맞는다
  });

  it('보스 4종이 전부 검술 체계로 통일됐다 — 돌진·광역 전용 데이터는 남아있지 않다', () => {
    for (const type of ['boss_demon', 'boss_knight', 'boss_golem', 'boss_dark_knight'] as const) {
      const data = monstersData[type];
      expect(data.meleeAttacks, type).toBeDefined();
      expect(data.meleeAttacks!.map((a) => a.anim), type).toEqual([1, 2, 3]);
      expect(data.chargeAttack, type).toBeUndefined();
      expect(data.slamAttack, type).toBeUndefined();
      // 거구라 전부 장애물을 밟고 지나간다.
      expect(data.crushesObstacles, type).toBe(true);
    }
  });
});
