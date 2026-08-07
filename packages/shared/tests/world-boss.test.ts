import { describe, expect, it } from 'vitest';
import { World, describeBossTelegraph, type MonsterEntity } from '../src/sim/world';
import { monstersData } from '../src/data';

const bossData = monstersData.boss_dark_knight;
const chargeData = bossData.chargeAttack!;
const slamData = bossData.slamAttack!;

/**
 * 보스 한 마리를 개발자 커맨드로 직접 스폰한다. 예전엔 wave 5로 점프해 잡몹 37마리
 * 사이에서 보스가 나올 때까지 틱했지만, 이제 보스는 잡몹을 전멸시켜야 나오는
 * 구조라(웨이브 경유가 훨씬 번거롭다) 패턴 로직만 검증하는 이 파일에서는 dev
 * 스폰으로 바로 만든다 — 패턴(charge/slam)은 스폰 경로와 무관하게 데이터만 보고
 * 동작하므로 검증 범위는 같다.
 *
 * 커맨드 실행용 플레이어는 아그로 반경 밖 맵 구석에 세워 보스의 행동에 영향을
 * 주지 않는다 — 이 파일의 테스트는 hp 변화량을 등호로 비교하므로, 테스트가 직접
 * 추가하는 플레이어 외에는 아무도 근처에 없어야 한다.
 */
function spawnBoss(world: World): MonsterEntity {
  world.addPlayer('dev', 1000, 1000);
  const result = world.runDevCommand('dev', 'spawn boss_dark_knight 1');
  if (!result.ok) throw new Error(`보스 스폰 실패: ${result.message}`);
  const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_dark_knight');
  if (!boss) throw new Error('보스가 스폰되지 않았다');
  return boss;
}

describe('World — 보스 특수 패턴', () => {
  it('스폰 직후 유예 시간 동안은 아그로 타겟이 있어도 특수 패턴을 쓰지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    world.addPlayer('p1', boss.x + boss.facingX * 10, boss.y + boss.facingY * 10);

    world.tick(1); // BOSS_FIRST_PATTERN_DELAY(3초)보다 짧다
    expect(boss.pattern.kind).toBe('idle');
  });

  it('유예 시간이 지나고 시야각 안에 타겟이 있으면 예고 상태로 전이한다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    // 보스가 바라보는 방향 바로 앞에 세워서 "처음 발견" 시야각 검사를 확실히 통과시킨다.
    world.addPlayer('p1', boss.x + boss.facingX * 10, boss.y + boss.facingY * 10);

    world.tick(3.5); // 유예 시간을 넘긴다
    expect(['chargeTelegraph', 'slamTelegraph']).toContain(boss.pattern.kind);
  });

  it('돌진 예고 중에는 보스가 이동하지 않고 방향을 유지한다', () => {
    const world = new World();
    const boss = spawnBoss(world);
    const startX = boss.x;
    const startY = boss.y;

    boss.pattern = {
      kind: 'chargeTelegraph',
      timer: chargeData.telegraphSeconds,
      total: chargeData.telegraphSeconds,
      dirX: 1,
      dirY: 0,
    };

    world.tick(chargeData.telegraphSeconds / 2);

    expect(boss.x).toBe(startX);
    expect(boss.y).toBe(startY);
    expect(boss.pattern.kind).toBe('chargeTelegraph');
    expect(boss.facingX).toBe(1);
    expect(boss.facingY).toBe(0);
  });

  it('돌진 예고가 끝나면 실제로 돌진하며 경로 위 플레이어를 한 번만 맞힌다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    // 보스 바로 오른쪽에 서 있는 플레이어 — 돌진 경로(+x) 위에 있다.
    world.addPlayer('target', boss.x + 15, boss.y);
    const player = world.getPlayers().get('target')!;
    const hpBefore = player.hp;

    boss.pattern = {
      kind: 'chargeTelegraph',
      timer: 0.01,
      total: chargeData.telegraphSeconds,
      dirX: 1,
      dirY: 0,
    };

    // 예고 종료 → charging 전이 → 돌진 실행까지, 여러 틱에 걸쳐 진행시킨다.
    for (let i = 0; i < 50 && boss.pattern.kind !== 'idle'; i += 1) {
      world.tick(chargeData.duration / 10);
    }

    expect(player.hp).toBe(hpBefore - chargeData.damage);
    expect(boss.pattern.kind).toBe('idle');
    expect(boss.specialAttackCooldown).toBeCloseTo(chargeData.cooldown, 5);
  });

  it('돌진 경로에서 벗어난 플레이어는 맞지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    // 돌진 방향(+x)과 직각인 y축으로 멀리 떨어뜨린다.
    world.addPlayer('safe', boss.x, boss.y + 500);
    const player = world.getPlayers().get('safe')!;
    const hpBefore = player.hp;

    boss.pattern = {
      kind: 'chargeTelegraph',
      timer: 0.01,
      total: chargeData.telegraphSeconds,
      dirX: 1,
      dirY: 0,
    };

    for (let i = 0; i < 50 && boss.pattern.kind !== 'idle'; i += 1) {
      world.tick(chargeData.duration / 10);
    }

    expect(player.hp).toBe(hpBefore);
  });

  it('광역 예고가 끝나면 예고 지점 반경 안의 플레이어에게 즉시 피해를 주고 idle로 복귀한다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    world.addPlayer('inside', boss.x, boss.y);
    const player = world.getPlayers().get('inside')!;
    const hpBefore = player.hp;

    boss.pattern = {
      kind: 'slamTelegraph',
      timer: 0.05,
      total: slamData.telegraphSeconds,
      x: boss.x,
      y: boss.y,
    };

    world.tick(0.1); // 타이머를 넘긴다

    expect(player.hp).toBe(hpBefore - slamData.damage);
    expect(boss.pattern.kind).toBe('idle');
    expect(boss.specialAttackCooldown).toBeCloseTo(slamData.cooldown, 5);
  });

  it('광역 범위 밖에 있는 플레이어는 피해를 받지 않는다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    world.addPlayer('outside', boss.x + slamData.radius + 200, boss.y); // 범위 밖 멀리
    const player = world.getPlayers().get('outside')!;
    const hpBefore = player.hp;

    boss.pattern = {
      kind: 'slamTelegraph',
      timer: 0.05,
      total: slamData.telegraphSeconds,
      x: boss.x,
      y: boss.y,
    };

    world.tick(0.1);

    expect(player.hp).toBe(hpBefore);
  });

  it('광역 지점은 예고 시작 시점에 고정되고, 플레이어가 그 자리에 있을 때만 맞는다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    // 예고 지점(boss.x, boss.y)에서 멀리 벗어난 채로 예고가 끝나게 한다.
    world.addPlayer('mover', boss.x + slamData.radius + 300, boss.y);
    const player = world.getPlayers().get('mover')!;
    const hpBefore = player.hp;

    boss.pattern = {
      kind: 'slamTelegraph',
      timer: 0.05,
      total: slamData.telegraphSeconds,
      x: boss.x,
      y: boss.y,
    };

    world.tick(0.1);

    expect(player.hp).toBe(hpBefore); // 지점 밖으로 피했으니 안 맞는다
  });

  it('describeBossTelegraph는 예고 중일 때만 정보를 돌려주고 idle/charging에는 undefined다', () => {
    const world = new World();
    const boss = spawnBoss(world);

    expect(describeBossTelegraph(boss, bossData)).toBeUndefined(); // idle

    boss.pattern = {
      kind: 'chargeTelegraph',
      timer: 0.6,
      total: chargeData.telegraphSeconds,
      dirX: 1,
      dirY: 0,
    };
    const chargeTelegraph = describeBossTelegraph(boss, bossData);
    expect(chargeTelegraph?.kind).toBe('charge');
    expect(chargeTelegraph?.radius).toBeCloseTo(chargeData.width / 2, 5);
    expect(chargeTelegraph?.range).toBeCloseTo(chargeData.speed * chargeData.duration, 5);
    expect(chargeTelegraph?.remaining).toBeCloseTo(0.6, 5);
    expect(chargeTelegraph?.total).toBeCloseTo(chargeData.telegraphSeconds, 5);

    boss.pattern = { kind: 'charging', timer: 0.2, dirX: 1, dirY: 0, hitPlayerIds: new Set() };
    expect(describeBossTelegraph(boss, bossData)).toBeUndefined(); // 돌진 실행 중엔 예고 없음

    boss.pattern = {
      kind: 'slamTelegraph',
      timer: 0.4,
      total: slamData.telegraphSeconds,
      x: 100,
      y: 200,
    };
    const slamTelegraph = describeBossTelegraph(boss, bossData);
    expect(slamTelegraph?.kind).toBe('slam');
    expect(slamTelegraph?.x).toBe(100);
    expect(slamTelegraph?.y).toBe(200);
    expect(slamTelegraph?.radius).toBe(slamData.radius);
    expect(slamTelegraph?.remaining).toBeCloseTo(0.4, 5);
  });
});
