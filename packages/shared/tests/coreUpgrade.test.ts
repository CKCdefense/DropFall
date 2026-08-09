import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { coreUpgradesData, itemsData } from '../src/data';
import { worldToCell } from '../src/constants';

/**
 * 강화 비용은 자원과 에너지를 **둘 다** 요구한다. 테스트에서 직접 채워 넣는다 —
 * 게이지 상한도 같이 올려야 비싼 단계를 살 수 있다(world-building.test.ts와 같은 패턴).
 */
function grantGauges(world: World, resource: number, energy: number): void {
  const core = world.getCore() as {
    resource: number;
    maxResource: number;
    energy: number;
    maxEnergy: number;
  };
  core.maxResource = Math.max(core.maxResource, resource);
  core.maxEnergy = Math.max(core.maxEnergy, energy);
  core.resource = resource;
  core.energy = energy;
}

/** 다음 단계를 딱 살 수 있을 만큼만 채운다. */
function grantExactly(world: World, tier: { cost: { resource: number; energy: number } }): void {
  grantGauges(world, tier.cost.resource, tier.cost.energy);
}

/**
 * 도구는 이제 팀 창고에서 시작한다(loadout.coreStorage) — 장착을 전제하는 테스트는
 * 명시적으로 꺼내 쓴다. 슬롯 순서는 예전 시작 지급품과 같다.
 */
function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  inventory.add('handgun', 1);
  inventory.add('axe_t1', 1);
  inventory.add('pickax_t1', 1);
  inventory.add('bandage', 3);
}

/**
 * 건축물을 세운다. 건축 모드가 사라져서 **아이템을 들고 설치하는 경로 하나뿐**이라,
 * 테스트도 같은 길을 탄다 — 아이템을 쥐어 주고 그 칸에 놓는다.
 */
function placeBuilding(world: World, playerId: string, type: string, cx: number, cy: number): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  const itemId = Object.entries(itemsData).find(([, item]) => item.buildingType === type)![0];
  // 시작 지급품이 네 칸을 다 채우고 있으면 add가 조용히 실패한다 — 한 칸 비우고 넣는다.
  inventory.takeAt(0);
  inventory.add(itemId, 1);
  world.selectSlot(
    playerId,
    inventory.toView().slots.findIndex((slot) => slot?.itemId === itemId),
  );
  world.placeHeldBuilding(playerId, cx, cy);
}

describe('World — 코어 업그레이드', () => {
  it('에너지가 충분하면 다음 단계를 사고, 비용이 차감되며 체력/최대체력/건설 반경이 늘어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    const tier0 = coreUpgradesData.tiers[0]!;
    grantExactly(world, tier0);

    const hpBefore = world.getCore().hp;
    const maxHpBefore = world.getCore().maxHp;
    const radiusBefore = world.getBuildRadius();

    world.upgradeCore('p1');

    const core = world.getCore();
    expect(core.tier).toBe(coreUpgradesData.startTier + 1);
    expect(core.resource).toBe(0); // 정확히 다 썼다
    expect(core.energy).toBe(0);
    expect(core.hp).toBe(hpBefore + tier0.coreHpBonus);
    expect(core.maxHp).toBe(maxHpBefore + tier0.coreHpBonus);
    expect(world.getBuildRadius()).toBe(radiusBefore + tier0.buildRadiusBonus);
    // 상한만 늘고 게이지는 비어 있다 — 다음 단계를 위해 다시 모아야 한다.
    expect(core.maxResource).toBeGreaterThan(tier0.cost.resource);
    expect(core.maxEnergy).toBeGreaterThan(tier0.cost.energy);
  });

  it('에너지가 부족하면 거절되고 아무것도 안 바뀐다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    // 자원은 넉넉하지만 에너지가 1 모자라다 — 한쪽만 모아선 못 올린다는 규칙.
    const tier0 = coreUpgradesData.tiers[0]!;
    grantGauges(world, tier0.cost.resource, tier0.cost.energy - 1);

    world.upgradeCore('p1');

    expect(world.getCore().tier).toBe(coreUpgradesData.startTier + 0);
    expect(world.getCore().resource).toBe(tier0.cost.resource); // 안 깎였다
    expect(world.getCore().energy).toBe(tier0.cost.energy - 1);
  });

  it('이미 최고 단계면 에너지가 아무리 많아도 더 살 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    for (const tier of coreUpgradesData.tiers) {
      grantExactly(world, tier);
      world.upgradeCore('p1');
    }
    expect(world.getCore().tier).toBe(coreUpgradesData.startTier + coreUpgradesData.tiers.length);

    grantGauges(world, 999999, 999999);
    world.upgradeCore('p1');

    expect(world.getCore().tier).toBe(coreUpgradesData.startTier + coreUpgradesData.tiers.length); // 그대로
    expect(world.getCore().resource).toBe(999999); // 차감되지 않았다
    expect(world.getCore().energy).toBe(999999);
  });

  it('존재하지 않는 플레이어의 요청은 무시된다', () => {
    const world = new World();
    grantGauges(world, 999999, 999999);

    expect(() => world.upgradeCore('ghost')).not.toThrow();
    expect(world.getCore().tier).toBe(coreUpgradesData.startTier + 0);
  });

  it('제작/스텟증가 해금은 그 단계부터 계속 유지된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    const craftingTierIndex = coreUpgradesData.tiers.findIndex((tier) => tier.unlocksCrafting);
    const statTierIndex = coreUpgradesData.tiers.findIndex((tier) => tier.unlocksStatUpgrades);
    expect(craftingTierIndex).toBeGreaterThanOrEqual(0); // 데이터에 해금 단계가 있어야 테스트가 의미 있다
    expect(statTierIndex).toBeGreaterThanOrEqual(0);

    for (let i = 0; i <= Math.max(craftingTierIndex, statTierIndex); i += 1) {
      const before = i < craftingTierIndex && i < statTierIndex;
      if (before) {
        expect(world.isCraftingUnlocked()).toBe(false);
        expect(world.isStatUpgradesUnlocked()).toBe(false);
      }
      grantExactly(world, coreUpgradesData.tiers[i]!);
      world.upgradeCore('p1');
    }

    expect(world.isCraftingUnlocked()).toBe(true);
    expect(world.isStatUpgradesUnlocked()).toBe(true);

    // 마지막 단계까지 다 사도 계속 유지돼야 한다(도로 잠기지 않는다).
    for (let i = Math.max(craftingTierIndex, statTierIndex) + 1; i < coreUpgradesData.tiers.length; i += 1) {
      grantExactly(world, coreUpgradesData.tiers[i]!);
      world.upgradeCore('p1');
    }
    expect(world.isCraftingUnlocked()).toBe(true);
    expect(world.isStatUpgradesUnlocked()).toBe(true);
  });

  it('건설 가능 반경 밖에는 지을 수 없고, 업그레이드로 반경을 넓히면 지을 수 있게 된다', () => {
    const world = new World();
    world.addPlayer('builder', 0, 0);
    equipDefaultKit(world, 'builder');

    // 건축 비용은 코어 자원 게이지에서 나간다. 이 테스트는 반경만 보려는 것이니
    // 자원 제약은 없애 둔다.
    grantGauges(world, 999999, 999999);

    // baseBuildRadius보다 확실히 먼 지점(반경 밖), 코어(0,0)에서 +x 방향.
    const farDistance = coreUpgradesData.baseBuildRadius + 50;
    const { cx, cy } = worldToCell(farDistance, 0);

    placeBuilding(world, 'builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(0); // 반경 밖이라 거절됐다

    // 그 지점이 반경 안에 들어올 만큼 충분히 업그레이드한다.
    for (let i = 0; i < coreUpgradesData.tiers.length; i += 1) {
      grantGauges(world, 999999, 999999);
      world.upgradeCore('builder');
      if (world.getBuildRadius() > farDistance + 16) break; // 셀 중심 오차 여유
    }
    // 강화가 게이지를 비우므로 다시 채운 뒤에 짓는다.
    grantGauges(world, 999999, 999999);

    placeBuilding(world, 'builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1); // 이제는 지어진다
  });
});

describe('World — 코어 수리', () => {
  /** 코어 체력을 임의로 깎는다(직접 맞아서 닳는 것과 결과가 같다). */
  function damageCore(world: World, amount: number): void {
    const core = world.getCore() as { hp: number };
    core.hp = Math.max(0, core.hp - amount);
  }

  it('낼 수 있는 자원만큼 체력을 채우고, 그만큼만 자원을 깎는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    damageCore(world, 100);
    grantGauges(world, 999999, 0);

    const hpBefore = world.getCore().hp;
    world.repairCore('p1');

    const core = world.getCore();
    expect(core.hp).toBe(core.maxHp); // 다 채웠다
    expect(core.hp).toBeGreaterThan(hpBefore);
    expect(core.resource).toBe(999999 - Math.ceil(100 * coreUpgradesData.repairResourcePerHp));
  });

  it('자원이 모자라면 낼 수 있는 만큼만 부분적으로 채운다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    damageCore(world, 100);
    // 100hp를 다 채우기엔 모자라지만, 일부는 채울 수 있는 자원.
    const partial = Math.ceil(100 * coreUpgradesData.repairResourcePerHp) - 5;
    grantGauges(world, partial, 0);

    const hpBefore = world.getCore().hp;
    world.repairCore('p1');

    const core = world.getCore();
    expect(core.hp).toBeGreaterThan(hpBefore);
    expect(core.hp).toBeLessThan(core.maxHp); // 다 못 채웠다
    expect(core.resource).toBeLessThan(partial); // 그래도 뭔가는 썼다
  });

  it('이미 꽉 찼으면 자원이 있어도 아무 일도 안 일어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    grantGauges(world, 999999, 0);

    world.repairCore('p1');

    expect(world.getCore().resource).toBe(999999); // 안 깎였다
  });

  it('자원이 0이면 아무 일도 안 일어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    damageCore(world, 100);
    grantGauges(world, 0, 0);

    const hpBefore = world.getCore().hp;
    world.repairCore('p1');

    expect(world.getCore().hp).toBe(hpBefore);
  });

  it('코어에서 멀면 수리할 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 900, 900);
    damageCore(world, 100);
    grantGauges(world, 999999, 0);

    const hpBefore = world.getCore().hp;
    world.repairCore('p1');

    expect(world.getCore().hp).toBe(hpBefore);
    expect(world.getCore().resource).toBe(999999);
  });

  it('존재하지 않는 플레이어의 요청은 무시된다', () => {
    const world = new World();
    damageCore(world, 100);
    grantGauges(world, 999999, 0);

    expect(() => world.repairCore('ghost')).not.toThrow();
    expect(world.getCore().resource).toBe(999999);
  });
});
