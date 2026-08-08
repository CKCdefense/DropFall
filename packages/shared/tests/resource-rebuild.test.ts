import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { buildingsData, chargingData, levelsData, monstersData, xpToNextLevel } from '../src/data';

/**
 * 자원 시스템 리빌딩(2026-08)으로 새로 생긴 규칙만 모았다 — 코어 충전, 게이지 상한,
 * 해머 수리, 경험치/레벨업/스탯 포인트. 강화·제작·상점은 기존 파일
 * (coreUpgrade.test.ts / economy.test.ts)이 계속 본다.
 */
function worldAtCore(): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  return world;
}

/** 충전 슬롯에 재료를 직접 올린다(드래그를 흉내 내는 대신 상태를 세운다). */
function putInCharge(world: World, index: number, itemId: string, count: number): void {
  world.getCore().chargeSlots[index] = { itemId, count };
}

/** world.ts의 격자 상수를 테스트에서 재구성한다(world-building.test.ts와 같은 방식). */
function worldToCell(x: number, y: number): { cx: number; cy: number } {
  const TILE = 16;
  const ORIGIN = -(128 * TILE) / 2;
  return { cx: Math.floor((x - ORIGIN) / TILE), cy: Math.floor((y - ORIGIN) / TILE) };
}

describe('코어 충전', () => {
  it('나무는 자원으로, 몬스터 드랍은 에너지로 들어간다', () => {
    const world = worldAtCore();
    putInCharge(world, 0, 'wood', 4);
    putInCharge(world, 1, 'drop_normal', 4);

    // 슬롯당 초당 itemsPerSecond개를 소화한다.
    world.tick(4 / chargingData.itemsPerSecond);

    expect(world.getCore().resource).toBe(4 * chargingData.materials.wood!.amount);
    expect(world.getCore().energy).toBe(4 * chargingData.materials.drop_normal!.amount);
    expect(world.getCore().chargeSlots[0]).toBeNull();
    expect(world.getCore().chargeSlots[1]).toBeNull();
  });

  it('시간이 든다 — 한 틱에 다 타지 않는다', () => {
    const world = worldAtCore();
    putInCharge(world, 0, 'wood', 20);

    world.tick(1 / 60);
    const slot = world.getCore().chargeSlots[0];

    expect(slot).not.toBeNull();
    expect(slot!.count).toBeGreaterThan(0);
    expect(world.getCore().resource).toBeLessThan(20 * chargingData.materials.wood!.amount);
  });

  it('60Hz로 잘게 틱해도 소수점 진행분이 사라지지 않는다', () => {
    // 틱마다 내림하면 "초당 2개"가 매번 0개로 잘려 영원히 아무것도 안 탄다.
    const world = worldAtCore();
    putInCharge(world, 0, 'wood', 10);

    for (let i = 0; i < 60; i += 1) world.tick(1 / 60);

    // 1초면 itemsPerSecond개가 타야 한다. 부동소수 누적 때문에 마지막 한 개가 다음
    // 틱으로 밀릴 수 있어 한 개 오차는 허용한다 — 여기서 보려는 건 "0이 아니다"이다.
    const perItem = chargingData.materials.wood!.amount;
    expect(world.getCore().resource).toBeGreaterThanOrEqual(
      (chargingData.itemsPerSecond - 1) * perItem,
    );
    expect(world.getCore().resource).toBeLessThanOrEqual(chargingData.itemsPerSecond * perItem);
  });

  it('게이지가 가득 차면 멈추고 재료가 슬롯에 남는다', () => {
    const world = worldAtCore();
    const core = world.getCore();
    core.resource = core.maxResource;
    putInCharge(world, 0, 'wood', 30);

    world.tick(10);

    expect(core.resource).toBe(core.maxResource); // 넘치지 않는다
    expect(core.chargeSlots[0]?.count).toBe(30); // 한 개도 안 탔다
  });

  it('충전 슬롯은 태울 수 없는 물건을 받지 않는다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    player.inventory.add('handgun', 1);
    const from = player.inventory.toView().slots.findIndex((slot) => slot?.itemId === 'handgun');

    world.moveItem('p1', 'inventory', from, 'charge', 0);

    expect(world.getCore().chargeSlots[0]).toBeNull();
    // 거절돼도 아이템은 원래 자리에 남는다 — 조용히 사라지면 안 된다.
    expect(player.inventory.slotAt(from)?.itemId).toBe('handgun');
  });

  it('나무는 받는다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    player.inventory.add('wood', 5);
    const from = player.inventory.toView().slots.findIndex((slot) => slot?.itemId === 'wood');

    world.moveItem('p1', 'inventory', from, 'charge', 0);

    expect(world.getCore().chargeSlots[0]).toEqual({ itemId: 'wood', count: 5 });
  });
});

describe('해머 수리', () => {
  /** 플레이어(0,0) 오른쪽에 벽 하나를 세우고 체력을 1로 깎아 둔다. */
  function worldWithDamagedWall(): { world: World; wall: { hp: number; maxHp: number } } {
    const world = worldAtCore();
    const core = world.getCore() as { resource: number; maxResource: number };
    core.maxResource = 100000;
    core.resource = 100000;

    // 코어 발자국 밖이면서 근접 사거리 안. 플레이어는 원점에 서 있다.
    const { cx, cy } = worldToCell(64, 0);
    world.placeBuilding('p1', 'wall', cx, cy);
    const wall = [...world.getBuildings().values()][0]!;
    wall.hp = 1;
    return { world, wall };
  }

  /** 무기를 들고 +x(벽 방향)으로 한 번 휘두른다. */
  function swingAt(world: World, weaponId: string): void {
    const player = world.getPlayers().get('p1')!;
    player.inventory.add(weaponId, 1);
    const index = player.inventory.toView().slots.findIndex((slot) => slot?.itemId === weaponId);
    world.selectSlot('p1', index);
    // 해머 사거리(24)가 짧다 — 벽 칸 중심(72,0) 바로 앞까지 붙어야 닿는다.
    player.x = 58;
    player.aimAngle = 0;
    world.fireWeapon('p1');
  }

  it('해머로 때리면 체력이 차고 자원이 든다', () => {
    const { world, wall } = worldWithDamagedWall();
    const before = world.getCore().resource;

    swingAt(world, 'hammer_t1');

    expect(wall.hp).toBe(1 + buildingsData.wall.repairPerHit);
    expect(world.getCore().resource).toBe(before - buildingsData.wall.repairCost);
  });

  it('해머가 아니면 아무 일도 없다 — 아군 건축물은 공격 대상이 아니다', () => {
    const { world, wall } = worldWithDamagedWall();
    const before = world.getCore().resource;

    swingAt(world, 'bat');

    expect(wall.hp).toBe(1);
    expect(world.getCore().resource).toBe(before);
  });

  it('자원이 없으면 고쳐지지 않는다', () => {
    const { world, wall } = worldWithDamagedWall();
    world.getCore().resource = 0;

    swingAt(world, 'hammer_t1');

    expect(wall.hp).toBe(1);
  });

  it('멀쩡한 건축물은 고치지 않는다(자원이 새지 않는다)', () => {
    const { world, wall } = worldWithDamagedWall();
    wall.hp = wall.maxHp;
    const before = world.getCore().resource;

    swingAt(world, 'hammer_t1');

    expect(world.getCore().resource).toBe(before);
  });
});

describe('경험치와 레벨업', () => {
  function killOne(world: World, type: string): void {
    world.runDevCommand('p1', `spawn ${type} 1`);
    const [id] = [...world.getMonsters().keys()];
    (world as unknown as { damageMonster(id: string, hp: number): void }).damageMonster(id!, 0);
  }

  it('몬스터를 잡으면 경험치가 오르고, 넘치면 레벨이 오른다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    const reward = monstersData.demon.xpReward;

    killOne(world, 'demon');
    expect(player.xp).toBe(reward);
    expect(player.level).toBe(1);

    const need = xpToNextLevel(1);
    const kills = Math.ceil((need - reward) / reward);
    for (let i = 0; i < kills; i += 1) killOne(world, 'demon');

    expect(player.level).toBe(2);
    expect(player.statPoints).toBe(levelsData.spPerLevel);
    expect(player.levelUpSeq).toBeGreaterThan(0);
  });

  it('경험치는 살아 있는 모두에게 같은 양이 들어간다 — 쓰러진 사람은 못 받는다', () => {
    const world = worldAtCore();
    world.addPlayer('p2', 0, 0);
    world.addPlayer('p3', 0, 0);
    world.getPlayers().get('p3')!.hp = 0;

    killOne(world, 'demon');

    const reward = monstersData.demon.xpReward;
    expect(world.getPlayers().get('p1')!.xp).toBe(reward);
    expect(world.getPlayers().get('p2')!.xp).toBe(reward);
    expect(world.getPlayers().get('p3')!.xp).toBe(0);
  });

  it('한 번에 두 레벨이 올라도 남는 경험치가 사라지지 않는다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    const need = xpToNextLevel(1) + xpToNextLevel(2);

    (world as unknown as { grantXp(amount: number): void }).grantXp(need + 5);

    expect(player.level).toBe(3);
    expect(player.xp).toBe(5);
    expect(player.statPoints).toBe(levelsData.spPerLevel * 2);
  });
});

describe('스탯 포인트', () => {
  it('포인트를 쓰면 최대치가 오르고, 오른 만큼 현재치도 찬다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    player.statPoints = 2;
    const maxHpBefore = world.playerMaxHp(player);
    player.hp = 1;

    world.spendStatPoint('p1', 'maxHp');

    expect(world.playerMaxHp(player)).toBe(maxHpBefore + levelsData.statPerPoint.maxHp);
    expect(player.hp).toBe(1 + levelsData.statPerPoint.maxHp);
    expect(player.statPoints).toBe(1);
  });

  it('공격력 포인트는 무기 데미지에 그대로 더해진다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    player.statPoints = 1;
    const before = world.playerAttack(player);

    world.spendStatPoint('p1', 'attack');

    expect(world.playerAttack(player)).toBe(before + levelsData.statPerPoint.attack);
  });

  it('포인트가 없으면 아무 일도 없고, 이상한 스탯 이름도 무시한다', () => {
    const world = worldAtCore();
    const player = world.getPlayers().get('p1')!;
    const before = world.playerMaxHp(player);

    world.spendStatPoint('p1', 'maxHp'); // 포인트 0
    player.statPoints = 1;
    world.spendStatPoint('p1', 'luck'); // 없는 스탯

    expect(world.playerMaxHp(player)).toBe(before);
    expect(player.statPoints).toBe(1); // 안 깎였다
  });
});
