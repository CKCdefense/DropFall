import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { coreUpgradesData } from '../src/data';
import { worldToCell } from '../src/constants';

/** 코어 공유 자원은 팀 자원이라 테스트에서 직접 채워 넣는다 — world-building.test.ts의
 * grantSharedResources와 동일한 패턴(테스트 전용 캐스팅). */
function grantEnergy(world: World, amount: number): void {
  const core = world.getCore() as { sharedEnergy: number };
  core.sharedEnergy = amount;
}

/**
 * 도구는 이제 팀 창고에서 시작한다(loadout.coreStorage) — 장착을 전제하는 테스트는
 * 명시적으로 꺼내 쓴다. 슬롯 순서는 예전 시작 지급품과 같다.
 */
function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  inventory.add('pistol', 1);
  inventory.add('axe', 1);
  inventory.add('pickax', 1);
  inventory.add('bandage', 3);
}

describe('World — 코어 업그레이드', () => {
  it('에너지가 충분하면 다음 단계를 사고, 비용이 차감되며 체력/최대체력/건설 반경이 늘어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    const tier0 = coreUpgradesData.tiers[0]!;
    grantEnergy(world, tier0.cost);

    const hpBefore = world.getCore().hp;
    const maxHpBefore = world.getCore().maxHp;
    const radiusBefore = world.getBuildRadius();

    world.upgradeCore('p1');

    const core = world.getCore();
    expect(core.tier).toBe(1);
    expect(core.sharedEnergy).toBe(0); // 정확히 다 썼다
    expect(core.hp).toBe(hpBefore + tier0.coreHpBonus);
    expect(core.maxHp).toBe(maxHpBefore + tier0.coreHpBonus);
    expect(world.getBuildRadius()).toBe(radiusBefore + tier0.buildRadiusBonus);
  });

  it('에너지가 부족하면 거절되고 아무것도 안 바뀐다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    grantEnergy(world, coreUpgradesData.tiers[0]!.cost - 1); // 1 모자라게

    world.upgradeCore('p1');

    expect(world.getCore().tier).toBe(0);
    expect(world.getCore().sharedEnergy).toBe(coreUpgradesData.tiers[0]!.cost - 1); // 안 깎였다
  });

  it('이미 최고 단계면 에너지가 아무리 많아도 더 살 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    for (const tier of coreUpgradesData.tiers) {
      grantEnergy(world, tier.cost);
      world.upgradeCore('p1');
    }
    expect(world.getCore().tier).toBe(coreUpgradesData.tiers.length);

    grantEnergy(world, 999999);
    world.upgradeCore('p1');

    expect(world.getCore().tier).toBe(coreUpgradesData.tiers.length); // 그대로
    expect(world.getCore().sharedEnergy).toBe(999999); // 차감되지 않았다
  });

  it('존재하지 않는 플레이어의 요청은 무시된다', () => {
    const world = new World();
    grantEnergy(world, 999999);

    expect(() => world.upgradeCore('ghost')).not.toThrow();
    expect(world.getCore().tier).toBe(0);
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
      grantEnergy(world, coreUpgradesData.tiers[i]!.cost);
      world.upgradeCore('p1');
    }

    expect(world.isCraftingUnlocked()).toBe(true);
    expect(world.isStatUpgradesUnlocked()).toBe(true);

    // 마지막 단계까지 다 사도 계속 유지돼야 한다(도로 잠기지 않는다).
    for (let i = Math.max(craftingTierIndex, statTierIndex) + 1; i < coreUpgradesData.tiers.length; i += 1) {
      grantEnergy(world, coreUpgradesData.tiers[i]!.cost);
      world.upgradeCore('p1');
    }
    expect(world.isCraftingUnlocked()).toBe(true);
    expect(world.isStatUpgradesUnlocked()).toBe(true);
  });

  it('건설 가능 반경 밖에는 지을 수 없고, 업그레이드로 반경을 넓히면 지을 수 있게 된다', () => {
    const world = new World();
    world.addPlayer('builder', 0, 0);
    equipDefaultKit(world, 'builder');

    // 건축 비용은 코어 창고에서 나간다(자원이 숫자 필드에서 슬롯으로 바뀌었다).
    const core = world.getCore() as { sharedEnergy: number };
    world.getCore().storage.add('wood', 100);
    world.getCore().storage.add('stone', 100);

    // baseBuildRadius보다 확실히 먼 지점(반경 밖), 코어(0,0)에서 +x 방향.
    const farDistance = coreUpgradesData.baseBuildRadius + 50;
    const { cx, cy } = worldToCell(farDistance, 0);

    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(0); // 반경 밖이라 거절됐다

    // 그 지점이 반경 안에 들어올 만큼 충분히 업그레이드한다.
    for (const tier of coreUpgradesData.tiers) {
      core.sharedEnergy = tier.cost;
      world.upgradeCore('builder');
      if (world.getBuildRadius() > farDistance + 16) break; // 셀 중심 오차 여유
    }

    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1); // 이제는 지어진다
  });
});
