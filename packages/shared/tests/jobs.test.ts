import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import {
  buildingsData,
  craftingData,
  itemsData,
  jobsData,
  monstersData,
  resourcesData,
} from '../src/data';
import { worldToCell } from '../src/constants';

/** 코어 상호작용 반경 안에 선 플레이어 하나. 제작·수리처럼 코어 앞에서만 되는 일에 쓴다. */
function playerAtCore(job: string): World {
  const world = new World();
  world.addPlayer('p1', 10, 0);
  world.setPlayerJob('p1', job);
  return world;
}

/** 인벤토리에서 그 아이템이 든 칸 번호(없으면 -1). */
function slotOf(world: World, playerId: string, itemId: string): number {
  return world
    .getPlayers()
    .get(playerId)!
    .inventory.toView()
    .slots.findIndex((slot) => slot?.itemId === itemId);
}

describe('직업 — 스태미나', () => {
  it('스태미나 100이면 2.5초 달리고 바닥난다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    world.setPlayerJob('p1', 'soldier'); // 스태미나 100
    const player = world.getPlayers().get('p1')!;
    expect(player.stamina).toBe(100);

    // 2.4초에는 아직 남아 있고, 2.5초를 넘기면 없다.
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0, sprint: true });
    for (let i = 0; i < 24; i += 1) world.tick(0.1);
    expect(world.getPlayers().get('p1')!.stamina).toBeGreaterThan(0);

    for (let i = 0; i < 3; i += 1) world.tick(0.1);
    expect(world.getPlayers().get('p1')!.stamina).toBe(0);
  });
});

describe('직업 — 병사: 경험치 +20%', () => {
  /** 잡몹 하나를 잡고 그 플레이어에게 들어온 경험치를 돌려준다. */
  function xpFromOneKill(job: string): number {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    world.setPlayerJob('p1', job);
    world.runDevCommand('p1', 'spawn demon 1');
    const [id] = [...world.getMonsters().keys()];
    world.damageMonster(id!, 0);
    return world.getPlayers().get('p1')!.xp;
  }

  it('병사는 다른 직업보다 20% 더 받는다', () => {
    const soldier = xpFromOneKill('soldier');
    const engineer = xpFromOneKill('engineer');
    expect(engineer).toBeGreaterThan(0);
    expect(soldier).toBe(Math.round(engineer * jobsData.soldier.xpMultiplier!));
  });
});

describe('직업 — 탐색꾼: 이동속도 1.1배', () => {
  it('걷는 속도부터 10% 빠르다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    world.addPlayer('p2', 600, 600);
    world.setPlayerJob('p1', 'searchman');
    world.setPlayerJob('p2', 'soldier');

    const fast = world.playerSpeedMultiplier(world.getPlayers().get('p1')!);
    const normal = world.playerSpeedMultiplier(world.getPlayers().get('p2')!);
    expect(fast / normal).toBeCloseTo(jobsData.searchman.speedMultiplier!, 5);
  });
});

describe('직업 — 엔지니어: 수리 자원 절반', () => {
  /** 울타리를 하나 세워 깎아 두고, 해머로 한 대 때렸을 때 나간 자원을 돌려준다. */
  function repairCost(job: string): number {
    const world = new World();
    // 건설 가능 구역은 코어 중심의 정사각형이라(getBuildRadius) 코어 가까이 짓는다.
    world.addPlayer('p1', 60, 8); // 짓는 셀과 같은 높이여야 해머 부채꼴에 들어온다
    world.setPlayerJob('p1', job);
    world.runDevCommand('p1', 'resource 999');

    const inventory = world.getPlayers().get('p1')!.inventory;
    const fenceItem = Object.entries(itemsData).find(([, item]) => item.buildingType === 'fence')![0];
    inventory.placeAt(0, { itemId: fenceItem, count: 1 });
    world.selectSlot('p1', 0);
    // 서 있는 셀이 아니라 바로 옆 셀에 짓는다(자기 발밑에는 못 짓는다).
    const { cx, cy } = worldToCell(90, 0);
    world.placeHeldBuilding('p1', cx, cy);

    const building = [...world.getBuildings().values()][0]!;
    building.hp = 1; // 수리 대상이 되려면 깎여 있어야 한다

    inventory.placeAt(0, { itemId: 'hammer_t2', count: 1 });
    world.selectSlot('p1', 0);
    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(0.001);

    const before = world.getCore().resource;
    world.fireWeapon('p1');
    return before - world.getCore().resource;
  }

  it('엔지니어는 절반만 낸다(올림 — 공짜가 되지는 않는다)', () => {
    const base = buildingsData.fence.repairCost;
    expect(repairCost('soldier')).toBe(base);
    expect(repairCost('engineer')).toBe(
      Math.max(1, Math.ceil(base * jobsData.engineer.repairCostMultiplier!)),
    );
  });
});

describe('직업 — 의무병: 붕대 제작', () => {
  const recipe = craftingData.recipes.find((entry) => entry.id === 'bandage')!;

  it('레시피에 직업 조건이 걸려 있다', () => {
    expect(recipe.requiresJob).toBe('medic');
  });

  it('의무병은 만들 수 있다', () => {
    const world = playerAtCore('medic');
    world.runDevCommand('p1', 'resource 999');
    world.runDevCommand('p1', 'energy 999');

    world.craftItem('p1', recipe.id);
    expect(world.getPlayers().get('p1')!.craftRecipeId).toBe(recipe.id);
  });

  it('다른 직업은 눌러도 아무 일도 일어나지 않는다 — 비용도 안 나간다', () => {
    const world = playerAtCore('soldier');
    world.runDevCommand('p1', 'resource 999');
    world.runDevCommand('p1', 'energy 999');
    const before = world.getCore().resource;

    world.craftItem('p1', recipe.id);
    expect(world.getPlayers().get('p1')!.craftRecipeId).toBe('');
    expect(world.getCore().resource).toBe(before);
  });
});

describe('직업 — 시작 지급품', () => {
  it('병사는 1번칸 리볼버, 4번칸 붕대', () => {
    const world = playerAtCore('soldier');
    const slots = world.getPlayers().get('p1')!.inventory.toView().slots;
    expect(slots[0]).toEqual({ itemId: 'revolver', count: 1 });
    expect(slots[3]).toEqual({ itemId: 'bandage', count: 1 });
  });

  it('엔지니어는 1번칸 T2 해머', () => {
    const world = playerAtCore('engineer');
    expect(world.getPlayers().get('p1')!.inventory.toView().slots[0]).toEqual({
      itemId: 'hammer_t2',
      count: 1,
    });
  });

  it('탐색꾼은 1번칸 토마호크, 4번칸 진통제', () => {
    const world = playerAtCore('searchman');
    const slots = world.getPlayers().get('p1')!.inventory.toView().slots;
    expect(slots[0]).toEqual({ itemId: 'tomahauk', count: 1 });
    expect(slots[3]).toEqual({ itemId: 'painkiller', count: 1 });
  });

  it('의무병의 붕대는 인원수만큼이다', () => {
    const world = new World();
    for (const id of ['p1', 'p2', 'p3']) world.addPlayer(id, 10, 0);
    world.setPlayerJob('p1', 'medic');
    world.startColonies(3); // 인원이 확정되는 시점 — 여기서 다시 센다

    const slots = world.getPlayers().get('p1')!.inventory.toView().slots;
    expect(slots[1]).toEqual({ itemId: 'bandage', count: 3 });
    expect(slots[2]).toEqual({ itemId: 'pills', count: 2 });
    expect(slots[3]).toEqual({ itemId: 'aid_kit', count: 1 });
  });

  it('직업을 바꿔 고르면 앞 직업의 지급품이 남지 않는다', () => {
    const world = playerAtCore('soldier');
    world.setPlayerJob('p1', 'searchman');

    expect(slotOf(world, 'p1', 'revolver')).toBe(-1);
    expect(slotOf(world, 'p1', 'tomahauk')).toBe(0);
  });
});

describe('토마호크 — 나무·돌 겸용, 두 번에 캔다', () => {
  /** 노드 하나를 바로 옆에 두고 토마호크로 때린 횟수를 돌려준다(최대 10). */
  function hitsToDeplete(type: 'wood' | 'stone'): number {
    const world = new World();
    world.addPlayer('p1', 2000, 2000); // 다른 노드와 겹치지 않게 멀리
    world.setPlayerJob('p1', 'searchman');
    world.selectSlot('p1', 0); // 토마호크

    const node = [...world.getResourceNodes().values()].find((entry) => entry.type === type)!;
    const player = world.getPlayers().get('p1')!;
    player.x = node.x - 20;
    player.y = node.y;
    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(0.001);

    for (let hits = 1; hits <= 10; hits += 1) {
      world.fireWeapon('p1');
      if (node.hp <= 0) return hits;
      world.tick(1); // 공격 주기를 넘긴다
    }
    return Infinity;
  }

  it('나무도 돌도 두 번이면 캔다', () => {
    expect(hitsToDeplete('wood')).toBe(2);
    expect(hitsToDeplete('stone')).toBe(2);
  });

  it('한 번에는 못 캔다 — 채집이 공짜가 되면 안 된다', () => {
    const gather = 2; // weapons.json의 gatherMultiplier
    const perHit = 14 * gather;
    expect(perHit).toBeLessThan(resourcesData.wood.hp);
    expect(perHit).toBeLessThan(resourcesData.stone.hp);
  });

  it('잡몹은 두세 방 때려야 잡힌다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    world.setPlayerJob('p1', 'searchman');
    world.selectSlot('p1', 0); // 토마호크
    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(0.001);

    // 한 대의 **실제** 피해를 잰다(무기 데미지 + 직업 공격력). 몬스터를 실제로 여러 번
    // 때려서 세지 않는 이유는, 사이사이 틱이 흐르면 몬스터가 움직이고 밤/낮이 넘어가는
    // 등 검증하려는 것과 무관한 변수가 끼어들기 때문이다.
    world.runDevCommand('p1', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;
    monster.x = 520;
    monster.y = 500;
    const before = monster.hp;
    world.fireWeapon('p1');
    const perHit = before - monster.hp;
    expect(perHit).toBeGreaterThan(0);

    for (const type of ['demon', 'hellhound', 'blood'] as const) {
      const hits = Math.ceil(monstersData[type]!.hp / perHit);
      expect(hits, type).toBeGreaterThanOrEqual(2);
      expect(hits, type).toBeLessThanOrEqual(3);
    }
  });
});
