import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { craftingData, itemsData, monstersData, shopData, wavesData } from '../src/data';

/**
 * 제작·상점은 전부 "코어 앞에서" 하는 행동이다. 코어는 항상 원점이라 (0,0)에
 * 세우면 반경 안이고, 멀리 두면 반경 밖이다.
 */
/** 매번 같은 시퀀스를 내는 결정론적 rng — 다른 테스트 파일과 같은 패턴이다. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function worldWithPlayerAtCore(): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  return world;
}

function stored(world: World, itemId: string): number {
  return world.getCore().storage.countOf(itemId);
}

/**
 * 창고에는 시작 지급품(loadout.coreStorage)이 이미 들어 있다 — 도끼도 권총도 처음부터
 * 한 자루씩 있다. 그래서 "몇 개가 되었나"가 아니라 **몇 개가 늘었나**로 본다.
 */
function countChange(world: World, itemId: string, act: () => void): number {
  const before = stored(world, itemId);
  act();
  return stored(world, itemId) - before;
}

/** 몬스터를 즉사시킨다. damageMonster는 private이지만 처치 보상 자체가 검증 대상이다. */
function killMonster(world: World, id: string): void {
  (world as unknown as { damageMonster(id: string, remainingHp: number): void }).damageMonster(id, 0);
}

function droppedCount(world: World, itemId: string): number {
  let total = 0;
  for (const drop of world.getDroppedItems().values()) {
    if (drop.itemId === itemId) total += drop.count;
  }
  return total;
}


/**
 * 코어 게이지를 채운다. 제작·구매 비용이 창고 재료에서 게이지로 옮겨 갔다 —
 * 창고에 나무를 쌓아 봐야 이제 아무것도 만들 수 없다(충전을 거쳐야 게이지가 된다).
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

/** 제작은 craftSeconds 뒤에 끝난다 — 결과를 보려면 그만큼 시간을 흘려야 한다. */
function finishCraft(world: World): void {
  world.tick(craftingData.craftSeconds + 0.01);
}

describe('World — 제작', () => {
  it('게이지가 충분하고 티어가 맞으면 자원이 줄고 결과물이 제작 칸에 놓인다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource, recipe.cost.energy ?? 0);
    const storedBefore = stored(world, recipe.itemId);

    world.craftItem('p1', recipe.id);
    finishCraft(world);

    // 창고로 바로 가지 않는다 — 만든 사람이 꺼내 가야 한다.
    expect(world.getPlayers().get('p1')!.craftOutput).toEqual({ itemId: recipe.itemId, count: 1 });
    expect(stored(world, recipe.itemId)).toBe(storedBefore);
    expect(world.getCore().resource).toBe(0); // 정확히 다 썼다
  });

  it('같은 물건이면 결과 칸에 쌓인다 — 연속으로 만들 수 있다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource * 2, 0);
    const perCraft = recipe.count ?? 1;

    world.craftItem('p1', recipe.id);
    finishCraft(world);
    world.craftItem('p1', recipe.id);
    finishCraft(world);

    expect(world.getPlayers().get('p1')!.craftOutput).toEqual({
      itemId: recipe.itemId,
      count: perCraft * 2,
    });
    expect(world.getCore().resource).toBe(0);
  });

  it('다른 물건은 쌓지 않는다 — 앞의 결과가 무엇이었는지 사라진다', () => {
    const world = worldWithPlayerAtCore();
    const first = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    const other = craftingData.recipes.find(
      (entry) => entry.itemId !== first.itemId && entry.requiresTier <= 1,
    )!;
    grantGauges(world, first.cost.resource + other.cost.resource, 999);

    world.craftItem('p1', first.id);
    finishCraft(world);
    const resourceBefore = world.getCore().resource;
    world.craftItem('p1', other.id); // 다른 물건이라 거절된다

    expect(world.getPlayers().get('p1')!.craftRecipeId).toBe('');
    expect(world.getCore().resource).toBe(resourceBefore);
  });

  it('상한(outputStackLimit)을 넘길 만큼은 시작조차 하지 않는다 — 비용도 안 나간다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource, 0);
    // 칸이 이미 상한까지 찬 상태를 만든다.
    world.getPlayers().get('p1')!.craftOutput = {
      itemId: recipe.itemId,
      count: craftingData.outputStackLimit,
    };

    world.craftItem('p1', recipe.id);

    expect(world.getPlayers().get('p1')!.craftRecipeId).toBe('');
    expect(world.getCore().resource).toBe(recipe.cost.resource);
  });

  it('결과를 꺼낼 때 다 못 들어간 나머지는 제작 칸에 남는다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'fence')!;
    const stackSize = itemsData[recipe.itemId]!.stackSize;
    const player = world.getPlayers().get('p1')!;
    // 상한 가까이 쌓아 두고, 인벤토리 한 칸에 한 개만 들어갈 자리를 만든다.
    player.craftOutput = { itemId: recipe.itemId, count: stackSize + 5 };
    const empty = player.inventory.toView().slots.findIndex((slot) => slot === null);

    world.moveItem('p1', 'craft', 0, 'inventory', empty);

    expect(player.inventory.slotAt(empty)).toEqual({ itemId: recipe.itemId, count: stackSize + 5 });
    expect(player.craftOutput).toBeNull();
  });

  it('제작 칸에서 인벤토리로 꺼내 갈 수 있다(넣는 건 안 된다)', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource, 0);
    world.craftItem('p1', recipe.id);
    finishCraft(world);

    const inventory = world.getPlayers().get('p1')!.inventory;
    const empty = inventory.toView().slots.findIndex((slot) => slot === null);
    world.moveItem('p1', 'craft', 0, 'inventory', empty);

    expect(inventory.slotAt(empty)?.itemId).toBe(recipe.itemId);
    expect(world.getPlayers().get('p1')!.craftOutput).toBeNull();

    // 반대 방향은 막힌다 — 제작 칸은 꺼내 가는 곳이지 보관함이 아니다.
    world.moveItem('p1', 'inventory', empty, 'craft', 0);
    expect(world.getPlayers().get('p1')!.craftOutput).toBeNull();
    expect(inventory.slotAt(empty)?.itemId).toBe(recipe.itemId);
  });

  it('제작에는 시간이 든다 — 걸자마자 결과물이 생기지는 않는다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource, 0);

    // 시작 지급품이 이미 창고에 있으므로 절대 개수가 아니라 증감으로 본다.
    const player = world.getPlayers().get('p1')!;

    world.craftItem('p1', recipe.id);
    // 비용은 먼저 나간다 — 진행 중에 남이 같은 자원을 써 버리면 완성 순간에 실패해야 하는데,
    // 그때는 이미 기다린 뒤라 설명할 방법이 없다.
    expect(world.getCore().resource).toBe(0);
    expect(player.craftOutput).toBeNull();

    world.tick(craftingData.craftSeconds * 0.5);
    expect(player.craftOutput).toBeNull(); // 아직 만드는 중

    finishCraft(world);
    expect(player.craftOutput?.itemId).toBe(recipe.itemId);
  });

  it('만드는 중에는 또 걸 수 없다(자원도 안 나간다)', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource * 2, 0);

    world.craftItem('p1', recipe.id);
    world.craftItem('p1', recipe.id); // 두 번째는 무시된다

    expect(world.getCore().resource).toBe(recipe.cost.resource);
    finishCraft(world);
    expect(world.getPlayers().get('p1')!.craftOutput?.count).toBe(1);
  });

  it('자원이 모자라면 아무것도 소비되지 않는다(부분 차감 금지)', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, recipe.cost.resource - 1, 0);

    const made = countChange(world, recipe.itemId, () => {
      world.craftItem('p1', recipe.id);
      finishCraft(world);
    });

    expect(made).toBe(0);
    expect(world.getCore().resource).toBe(recipe.cost.resource - 1); // 그대로 남았다
  });

  it('에너지도 요구하는 레시피는 자원만으로는 못 만든다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => (entry.cost.energy ?? 0) > 0)!;
    (world.getCore() as { tier: number }).tier = recipe.requiresTier;
    grantGauges(world, recipe.cost.resource, 0);

    world.craftItem('p1', recipe.id);
    finishCraft(world);

    expect(world.getPlayers().get('p1')!.craftOutput).toBeNull();
    expect(world.getCore().resource).toBe(recipe.cost.resource);
  });

  it('울타리·벽은 한 번에 여섯 개가 나온다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.id === 'fence')!;
    grantGauges(world, recipe.cost.resource, 0);

    world.craftItem('p1', recipe.id);
    finishCraft(world);

    expect(world.getPlayers().get('p1')!.craftOutput).toEqual({ itemId: 'fence', count: 6 });
  });

  it('코어 티어가 모자란 레시피는 자원이 넘쳐도 만들 수 없다', () => {
    const world = worldWithPlayerAtCore();
    const recipe = craftingData.recipes.find((entry) => entry.requiresTier > world.getCore().tier)!;
    grantGauges(world, 999999, 999999);

    world.craftItem('p1', recipe.id);
    finishCraft(world);

    expect(world.getPlayers().get('p1')!.craftOutput).toBeNull();
  });

  it('만들 수 있는 목록은 현재 티어까지만 나온다', () => {
    const world = worldWithPlayerAtCore();
    const tier = world.getCore().tier;

    const available = world.availableRecipes();

    expect(available.length).toBeGreaterThan(0);
    expect(available.every((recipe) => recipe.requiresTier <= tier)).toBe(true);
    expect(available.length).toBeLessThan(craftingData.recipes.length); // 잠긴 게 남아 있다
  });

  it('코어에서 멀면 제작할 수 없다(코어에 손이 닿지 않는다)', () => {
    const world = new World();
    world.addPlayer('far', 2000, 2000);
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    grantGauges(world, 999999, 0);

    world.craftItem('far', recipe.id);
    finishCraft(world);

    expect(world.getPlayers().get('far')!.craftOutput).toBeNull();
  });
});

describe('World — 상점', () => {
  it('에너지가 충분하면 사고, 물건은 창고로 들어간다', () => {
    const world = worldWithPlayerAtCore();
    const itemId = world.getCore().shopStock[0]!;
    const price = itemsData[itemId]!.buyPrice!;
    grantGauges(world, 0, price + 5);

    const bought = countChange(world, itemId, () => world.buyFromShop('p1', itemId));

    expect(bought).toBe(1);
    expect(world.getCore().energy).toBe(5);
  });

  it('에너지가 모자라면 사지 못하고 에너지도 그대로다', () => {
    const world = worldWithPlayerAtCore();
    const itemId = world.getCore().shopStock[0]!;
    const price = itemsData[itemId]!.buyPrice!;
    grantGauges(world, 0, price - 1);

    const bought = countChange(world, itemId, () => world.buyFromShop('p1', itemId));

    expect(bought).toBe(0);
    expect(world.getCore().energy).toBe(price - 1);
  });

  it('진열되지 않은 물건은 살 수 없다', () => {
    const world = worldWithPlayerAtCore();
    grantGauges(world, 0, 99999);

    const bought = countChange(world, 'wood', () => world.buyFromShop('p1', 'wood'));

    expect(bought).toBe(0);
    expect(world.getCore().energy).toBe(99999);
  });
});

describe('World — 몬스터 드랍 테이블', () => {
  it('데이터의 모든 드랍 아이템이 items.json에 있고 판매가가 붙어 있다', () => {
    for (const monster of Object.values(monstersData)) {
      for (const entry of monster.itemDrops ?? []) {
        const item = itemsData[entry.itemId];
        expect(item, `${entry.itemId}가 items.json에 없다`).toBeDefined();
        // 드랍은 상점에 파는 게 용도다 — 팔 수 없으면 쓸 데가 없다.
        expect(item!.sellPrice).toBeGreaterThan(0);
        expect(entry.max).toBeGreaterThanOrEqual(entry.min);
      }
    }
  });

  it('rng가 항상 0이면(=최저값) 확률이 붙은 드랍이 전부 터진다', () => {
    // rng()가 0이면 `rng() >= chance`가 항상 거짓이라 모든 항목이 통과한다.
    const world = new World({ rng: () => 0 });
    const type = 'demon';
    const drops = monstersData[type].itemDrops ?? [];
    expect(drops.length, 'demon에 드랍 테이블이 있어야 이 테스트가 의미 있다').toBeGreaterThan(0);

    world.debugJumpToWave(1);
    world.tick(0.001);
    const monster = [...world.getMonsters().values()].find((entity) => entity.type === type)!;
    expect(monster).toBeDefined();
    killMonster(world, monster.id);

    for (const entry of drops) {
      expect(droppedCount(world, entry.itemId)).toBeGreaterThanOrEqual(entry.min);
    }
  });

  it('rng가 항상 1이면(=최고값) 확률이 1 미만인 드랍은 하나도 안 나온다', () => {
    const world = new World({ rng: () => 0.999999 });
    const drops = (monstersData.demon.itemDrops ?? []).filter((entry) => entry.chance < 1);
    expect(drops.length).toBeGreaterThan(0);

    world.debugJumpToWave(1);
    world.tick(0.001);
    const monster = [...world.getMonsters().values()].find((entity) => entity.type === 'demon')!;
    killMonster(world, monster.id);

    for (const entry of drops) {
      expect(droppedCount(world, entry.itemId)).toBe(0);
    }
  });
});

describe('World — 상점 로테이션', () => {
  it('하루 진열은 무기 N개 + 소모품 N개다(shop.json이 정한 수)', () => {
    const world = worldWithPlayerAtCore();
    const stock = world.getCore().shopStock;

    expect(stock).toHaveLength(shopData.weaponsPerDay + shopData.consumablesPerDay);

    const kinds = stock.map((itemId) => itemsData[itemId]!.kind);
    expect(kinds.filter((kind) => kind === 'weapon')).toHaveLength(shopData.weaponsPerDay);
    expect(kinds.filter((kind) => kind === 'consumable')).toHaveLength(shopData.consumablesPerDay);
  });

  it('전설 등장 확률이 10%다(가중치 비율이 곧 확률)', () => {
    const weights = shopData.rarityWeights;
    const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

    expect(weights.legendary! / total).toBeCloseTo(0.1, 5);
  });

  it('실제로 뽑아봐도 전설 비율이 10% 근처다', () => {
    // 한 판(3+3칸)에는 중복 제거가 걸려서 확률이 조금 달라진다 — **첫 칸**만 모으면
    // 가중치 그대로의 분포가 나온다. World를 200번 새로 만드는 거라 기본 타임아웃(5초)
    // 으로는 모자라서 넉넉히 준다.
    let legendary = 0;
    const ROUNDS = 200;
    for (let seed = 1; seed <= ROUNDS; seed += 1) {
      const first = new World({ rng: seededRng(seed * 7919) }).getCore().shopStock[0]!;
      if (itemsData[first]!.rarity === 'legendary') legendary += 1;
    }

    // 200판이면 10%의 표준편차가 약 2.1%p다 — ±6%p 여유면 우연히 깨지지 않는다.
    expect(legendary / ROUNDS).toBeGreaterThan(0.04);
    expect(legendary / ROUNDS).toBeLessThan(0.16);
  }, 30_000);

  it('같은 물건이 두 칸에 겹치지 않는다', () => {
    // 뽑기는 무작위라 한 판만 보면 우연히 통과할 수 있다 — 여러 시드로 반복해서 본다.
    for (let seed = 1; seed <= 30; seed += 1) {
      const world = new World({ rng: seededRng(seed) });
      const stock = world.getCore().shopStock;
      expect(new Set(stock).size).toBe(stock.length);
    }
  });

  it('진열된 것은 전부 살 수 있는 물건이다(등급·가격이 붙어 있다)', () => {
    const world = worldWithPlayerAtCore();
    for (const itemId of world.getCore().shopStock) {
      const item = itemsData[itemId];
      expect(item, `${itemId}가 items.json에 없다`).toBeDefined();
      expect(item!.rarity).toBeDefined();
      expect(item!.buyPrice).toBeGreaterThan(0);
    }
  });

  it('밤이 지나 새 낮이 오면 진열이 새로 뽑힌다', () => {
    const world = new World({ rng: seededRng(7) });
    const before = [...world.getCore().shopStock];

    // 낮 → 밤 → (몬스터 전멸) → 새 낮. 몬스터는 즉시 지워서 웨이브를 끝낸다.
    world.tick(wavesData.dayDuration + 0.001);
    for (let i = 0; i < 3000 && world.getWavePhase() !== 'day'; i += 1) {
      for (const monster of [...world.getMonsters().values()]) {
        (world as unknown as { damageMonster(id: string, hp: number): void }).damageMonster(
          monster.id,
          0,
        );
      }
      world.tick(0.1);
    }
    expect(world.getWavePhase()).toBe('day'); // 실제로 다음 낮까지 갔다

    // 뽑기는 무작위라 "다르다"를 단언하면 우연히 같을 때 깨진다 — 다시 뽑혔다는 사실은
    // 규칙(개수·중복 없음)이 여전히 지켜지는지로 확인한다.
    const after = world.getCore().shopStock;
    expect(after).toHaveLength(before.length);
    expect(new Set(after).size).toBe(after.length);
  });

  it('어제 진열됐던(오늘은 아닌) 물건은 살 수 없다', () => {
    const world = worldWithPlayerAtCore();
    const stock = world.getCore().shopStock;
    const notStocked = Object.keys(itemsData).find(
      (itemId) => itemsData[itemId]!.buyPrice !== undefined && !stock.includes(itemId),
    )!;
    grantGauges(world, 0, 99999);

    const bought = countChange(world, notStocked, () => world.buyFromShop('p1', notStocked));

    expect(bought).toBe(0);
    expect(world.getCore().energy).toBe(99999);
  });
});
