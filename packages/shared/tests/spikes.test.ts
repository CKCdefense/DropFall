import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { buildingsData, itemsData } from '../src/data';
import { cellCenterWorld, worldToCell } from '../src/constants';

/** 코어 근처 빈 칸에 스파이크를 한 장 깐다. 깐 건축물을 돌려준다. */
function placeSpike(world: World, type = 'spike', at = { x: 90, y: 0 }) {
  const inventory = world.getPlayers().get('p1')!.inventory;
  inventory.placeAt(0, { itemId: type, count: 1 });
  world.selectSlot('p1', 0);
  const { cx, cy } = worldToCell(at.x, at.y);
  world.placeHeldBuilding('p1', cx, cy);
  const building = [...world.getBuildings().values()].find((entry) => entry.type === type);
  expect(building, `${type} 설치`).toBeDefined();
  return building!;
}

/** 플레이어 하나를 코어 옆에 세운 월드. */
function setup(): World {
  const world = new World();
  world.addPlayer('p1', 60, 8);
  return world;
}

describe('스파이크 — 통행과 감속', () => {
  it('이동을 막지 않는다 — 잡몹에게는 뚫린 길이다', () => {
    for (const type of ['spike', 'stone_spike', 'iron_spike']) {
      expect(buildingsData[type]!.blocksMovement).toBe(false);
      expect(buildingsData[type]!.blocksProjectile).toBe(false);
    }
  });

  it('티어별 감속이 20/30/40%다', () => {
    expect(buildingsData.spike!.slowMultiplier).toBeCloseTo(0.8);
    expect(buildingsData.stone_spike!.slowMultiplier).toBeCloseTo(0.7);
    expect(buildingsData.iron_spike!.slowMultiplier).toBeCloseTo(0.6);
  });

  it('플레이어도 스파이크 위에서 같은 비율로 느려진다', () => {
    const world = setup();
    const spike = placeSpike(world);
    const player = world.getPlayers().get('p1')!;

    const before = world.playerSpeedMultiplier(player);
    player.x = spike.x;
    player.y = spike.y;
    const on = world.playerSpeedMultiplier(player);

    expect(on / before).toBeCloseTo(buildingsData.spike!.slowMultiplier!, 5);
  });

  it('잡몹은 스파이크 위에서 느려진다', () => {
    const world = setup();
    const spike = placeSpike(world);
    world.runDevCommand('p1', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;

    // 같은 방향·같은 시간을 스파이크 위/평지에서 각각 걷게 해 이동 거리를 비교한다.
    const walk = (x: number, y: number): number => {
      monster.x = x;
      monster.y = y;
      monster.pattern = { kind: 'idle' };
      const beforeX = monster.x;
      (world as unknown as {
        moveMonster(m: unknown, dx: number, dy: number, s: number, dt: number): void;
      }).moveMonster(monster, 1, 0, 100, 0.05);
      return monster.x - beforeX;
    };

    const onSpike = walk(spike.x, spike.y);
    const onGround = walk(spike.x, spike.y + 200);
    expect(onSpike / onGround).toBeCloseTo(buildingsData.spike!.slowMultiplier!, 2);
  });

  it('보스는 느려지지 않는다', () => {
    const world = setup();
    const spike = placeSpike(world);
    world.runDevCommand('p1', 'spawn boss_demon 1');
    const boss = [...world.getMonsters().values()][0]!;

    const walk = (x: number, y: number): number => {
      boss.x = x;
      boss.y = y;
      const beforeX = boss.x;
      (world as unknown as {
        moveMonster(m: unknown, dx: number, dy: number, s: number, dt: number): void;
      }).moveMonster(boss, 1, 0, 100, 0.05);
      return boss.x - beforeX;
    };

    const onSpike = walk(spike.x, spike.y);
    const onGround = walk(spike.x, spike.y + 200);
    expect(onSpike).toBeCloseTo(onGround, 2);
  });
});

describe('스파이크 — 마모', () => {
  it('위에 몬스터가 서 있는 동안 마릿수 × 시간만큼 닳는다', () => {
    const world = setup();
    const spike = placeSpike(world);
    world.runDevCommand('p1', 'spawn demon 2');
    for (const monster of world.getMonsters().values()) {
      monster.x = spike.x;
      monster.y = spike.y;
      monster.pattern = { kind: 'idle' };
    }

    const before = spike.hp;
    world.tick(0.001); // 상태 반영
    const afterFirst = spike.hp;
    expect(afterFirst).toBeLessThanOrEqual(before);

    // 2마리 × wear × 1초 근사치만큼 깎였는지 — 몬스터가 틱 중에 움직여 칸을 벗어날 수
    // 있으므로 매 틱 제자리에 되돌려 세운다.
    let elapsed = 0;
    while (elapsed < 1) {
      for (const monster of world.getMonsters().values()) {
        monster.x = spike.x;
        monster.y = spike.y;
      }
      world.tick(0.05);
      elapsed += 0.05;
    }
    const wear = buildingsData.spike!.wearPerMonsterSecond!;
    expect(before - spike.hp).toBeGreaterThanOrEqual(wear * 2 * 0.9);
  });

  it('아무도 밟지 않으면 닳지 않는다', () => {
    const world = setup();
    const spike = placeSpike(world);
    world.runDevCommand('p1', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;
    monster.x = spike.x + 500;
    monster.y = spike.y + 500;

    const before = spike.hp;
    world.tick(0.2);
    expect(spike.hp).toBe(before);
  });

  it('다 닳으면 아무것도 남기지 않고 사라진다', () => {
    const world = setup();
    const spike = placeSpike(world);
    spike.hp = 0.01;
    world.runDevCommand('p1', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;
    monster.x = spike.x;
    monster.y = spike.y;

    world.tick(0.1);
    expect(world.getBuildings().has(spike.id)).toBe(false);
    expect([...world.getDroppedItems().values()]).toHaveLength(0);
  });
});

describe('스파이크 — 파괴와 회수(벽과 같은 규칙)', () => {
  /** p1이 스파이크 옆에서 지정한 무기로 한 번 휘두른다. */
  function smash(world: World, weaponId: string): void {
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(1, { itemId: weaponId, count: 1 });
    world.selectSlot('p1', 1);
    world.setInput('p1', { seq: 9, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(0.001);
    world.fireWeapon('p1');
  }

  it('일반 근접 무기로 부수면 그냥 사라진다', () => {
    const world = setup();
    const spike = placeSpike(world);
    spike.hp = 1;
    smash(world, 'bat');

    expect(world.getBuildings().has(spike.id)).toBe(false);
    expect([...world.getDroppedItems().values()]).toHaveLength(0);
  });

  it('해머로 부수면 아이템으로 떨어진다', () => {
    const world = setup();
    const spike = placeSpike(world);
    smash(world, 'hammer_t2'); // 해머는 성한 건축물을 한 방에 뜯는다

    expect(world.getBuildings().has(spike.id)).toBe(false);
    const drops = [...world.getDroppedItems().values()];
    expect(drops).toHaveLength(1);
    expect(drops[0]!.itemId).toBe('spike');
    expect(itemsData.spike!.buildingType).toBe('spike');
  });

  it('설치한 칸의 좌표가 격자 중심에 온다(다른 건축물과 같은 배치 규칙)', () => {
    const world = setup();
    const spike = placeSpike(world);
    const cell = worldToCell(spike.x, spike.y);
    const centre = cellCenterWorld(cell.cx, cell.cy);
    expect(spike.x).toBe(centre.x);
    expect(spike.y).toBe(centre.y);
  });
});
