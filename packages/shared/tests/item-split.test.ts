import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Inventory } from '../src/sim/inventory';

/** 코어 앞에 선 플레이어 하나. 창고를 만지려면 코어 근처여야 한다. */
function setup(): World {
  const world = new World();
  world.addPlayer('p1', 10, 0);
  const inventory = world.getPlayers().get('p1')!.inventory;
  // 시작 지급품이 칸을 차지하고 있어 자리를 먼저 비운다.
  for (let index = 0; index < 4; index += 1) inventory.takeAt(index);
  return world;
}

function slots(world: World) {
  return world.getPlayers().get('p1')!.inventory.toView().slots;
}

describe('Inventory.takeAt — 부분 분할', () => {
  it('개수를 안 주면 칸을 통째로 꺼낸다(예전 동작)', () => {
    const inventory = new Inventory();
    inventory.placeAt(0, { itemId: 'bandage', count: 5 });

    expect(inventory.takeAt(0)).toEqual({ itemId: 'bandage', count: 5 });
    expect(inventory.slotAt(0)).toBeNull();
  });

  it('개수를 주면 그만큼만 떼고 나머지는 칸에 남는다', () => {
    const inventory = new Inventory();
    inventory.placeAt(0, { itemId: 'bandage', count: 5 });

    expect(inventory.takeAt(0, 2)).toEqual({ itemId: 'bandage', count: 2 });
    expect(inventory.slotAt(0)).toEqual({ itemId: 'bandage', count: 3 });
  });

  it('보유량 이상을 요구하면 통째로 나온다 — 칸이 비고 빚이 남지 않는다', () => {
    const inventory = new Inventory();
    inventory.placeAt(0, { itemId: 'bandage', count: 3 });

    expect(inventory.takeAt(0, 99)).toEqual({ itemId: 'bandage', count: 3 });
    expect(inventory.slotAt(0)).toBeNull();
  });
});

describe('moveItem — 낱개 나누기', () => {
  it('빈 칸으로 절반만 옮긴다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 5 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 3);

    expect(slots(world)[0]).toEqual({ itemId: 'bandage', count: 2 });
    expect(slots(world)[1]).toEqual({ itemId: 'bandage', count: 3 });
  });

  it('같은 물건 위에 놓으면 합쳐진다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 4 });
    inventory.placeAt(1, { itemId: 'bandage', count: 1 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 2);

    expect(slots(world)[0]).toEqual({ itemId: 'bandage', count: 2 });
    expect(slots(world)[1]).toEqual({ itemId: 'bandage', count: 3 });
  });

  it('다른 물건 위에는 나눠 놓을 수 없다 — 아무 일도 일어나지 않는다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 5 });
    inventory.placeAt(1, { itemId: 'pills', count: 1 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 2);

    // 자리 바꾸기가 되면 밀려난 알약을 되돌릴 자리가 없다(원래 칸에 붕대가 남아 있다).
    expect(slots(world)[0]).toEqual({ itemId: 'bandage', count: 5 });
    expect(slots(world)[1]).toEqual({ itemId: 'pills', count: 1 });
  });

  it('통째로 옮기는 이동은 다른 물건과 여전히 자리를 바꾼다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 5 });
    inventory.placeAt(1, { itemId: 'pills', count: 1 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1);

    expect(slots(world)[0]).toEqual({ itemId: 'pills', count: 1 });
    expect(slots(world)[1]).toEqual({ itemId: 'bandage', count: 5 });
  });

  it('개수를 부풀려 보내도 보유량까지만 옮겨진다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 2 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 999);

    expect(slots(world)[0]).toBeNull();
    expect(slots(world)[1]).toEqual({ itemId: 'bandage', count: 2 });
  });

  it('0이나 음수를 보내도 최소 한 개는 옮긴다 — 손은 움직였는데 결과가 없으면 안 된다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 4 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 0);
    expect(slots(world)[1]).toEqual({ itemId: 'bandage', count: 1 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 2, -5);
    expect(slots(world)[2]).toEqual({ itemId: 'bandage', count: 1 });
  });

  it('창고로도 나눠 넣을 수 있다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 6 });
    // 창고 빈 칸을 찾는다(시작 지급 도구가 앞칸을 쓴다).
    const storage = world.getCore().storage;
    const empty = storage.toView().slots.findIndex((slot) => slot === null);

    world.moveItem('p1', 'inventory', 0, 'storage', empty, 4);

    expect(slots(world)[0]).toEqual({ itemId: 'bandage', count: 2 });
    expect(storage.slotAt(empty)).toEqual({ itemId: 'bandage', count: 4 });
  });

  it('나눠 옮겨도 총 개수는 그대로다', () => {
    const world = setup();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.placeAt(0, { itemId: 'bandage', count: 7 });

    world.moveItem('p1', 'inventory', 0, 'inventory', 1, 4);
    world.moveItem('p1', 'inventory', 1, 'inventory', 2, 2);

    expect(inventory.countOf('bandage')).toBe(7);
  });
});
