import { describe, expect, it } from 'vitest';
import { Inventory, SLOT_COUNT, itemOfSlot } from '../src/sim/inventory';
import { World } from '../src/sim/world';
import { wavesData } from '../src/data';

/**
 * 예전 시작 지급품(권총/도끼/곡괭이/붕대)을 손에 쥐여준다. 이제 도구는 팀 창고에서
 * 시작하므로(loadout.coreStorage), 장착을 전제하는 테스트는 명시적으로 꺼내 쓴다.
 * 슬롯 순서는 예전과 같아서 기존 selectSlot 번호가 그대로 유효하다.
 */
function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  inventory.add('pistol', 1);
  inventory.add('axe_t1', 1);
  inventory.add('pickax_t1', 1);
  inventory.add('bandage', 3);
}

describe('Inventory', () => {
  it('빈 인벤토리는 SLOT_COUNT개의 빈 칸을 가진다', () => {
    const view = new Inventory().toView();
    expect(view.slots).toHaveLength(SLOT_COUNT);
    expect(view.slots.every((slot) => slot === null)).toBe(true);
    expect(view.selectedIndex).toBe(0);
  });

  it('아이템을 넣으면 앞 칸부터 채운다', () => {
    const inventory = new Inventory();
    inventory.add('pistol');
    inventory.add('axe_t1');

    expect(inventory.slotAt(0)).toEqual({ itemId: 'pistol', count: 1 });
    expect(inventory.slotAt(1)).toEqual({ itemId: 'axe_t1', count: 1 });
  });

  it('같은 아이템은 새 칸을 열기 전에 기존 더미에 쌓인다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);
    inventory.add('bandage', 2);

    expect(inventory.slotAt(0)).toEqual({ itemId: 'bandage', count: 4 });
    expect(inventory.slotAt(1)).toBeNull();
  });

  it('stackSize를 넘으면 다음 칸으로 넘어간다', () => {
    const inventory = new Inventory();
    // 붕대 stackSize = 5
    inventory.add('bandage', 7);

    expect(inventory.slotAt(0)).toEqual({ itemId: 'bandage', count: 5 });
    expect(inventory.slotAt(1)).toEqual({ itemId: 'bandage', count: 2 });
  });

  it('무기는 stackSize 1이라 겹치지 않고 칸을 따로 쓴다', () => {
    const inventory = new Inventory();
    inventory.add('pistol', 3);

    expect(inventory.slotAt(0)).toEqual({ itemId: 'pistol', count: 1 });
    expect(inventory.slotAt(1)).toEqual({ itemId: 'pistol', count: 1 });
    expect(inventory.slotAt(2)).toEqual({ itemId: 'pistol', count: 1 });
  });

  it('칸이 모자라면 못 넣은 개수를 돌려준다(조용히 증발시키지 않는다)', () => {
    const inventory = new Inventory();
    // 4칸 × stackSize 1 = 4개가 한계
    const leftover = inventory.add('pistol', 6);

    expect(leftover).toBe(2);
  });

  it('모르는 아이템 id는 넣지 않고 그대로 돌려준다', () => {
    const inventory = new Inventory();
    expect(inventory.add('not-an-item', 3)).toBe(3);
    expect(inventory.slotAt(0)).toBeNull();
  });

  it('개수가 0이 되면 칸이 비워진다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);

    expect(inventory.removeAt(0, 2)).toBe(2);
    expect(inventory.slotAt(0)).toBeNull();
  });

  it('가진 것보다 많이 빼려 하면 있는 만큼만 빠진다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);

    expect(inventory.removeAt(0, 99)).toBe(2);
  });

  it('범위 밖 슬롯은 선택되지 않는다', () => {
    const inventory = new Inventory();
    expect(inventory.select(SLOT_COUNT)).toBe(false);
    expect(inventory.select(-1)).toBe(false);
    expect(inventory.select(1.5)).toBe(false);
    expect(inventory.select('1')).toBe(false);
    expect(inventory.toView().selectedIndex).toBe(0);
  });

  it('빈 칸도 선택할 수 있다(맨손)', () => {
    const inventory = new Inventory();
    inventory.add('pistol');

    expect(inventory.select(2)).toBe(true);
    expect(inventory.selected).toBeNull();
    expect(inventory.equippedWeaponId).toBeUndefined();
  });

  it('무기 칸을 고르면 장착 무기가 나온다', () => {
    const inventory = new Inventory();
    inventory.add('pistol');
    inventory.add('axe_t1');

    inventory.select(1);
    expect(inventory.equippedWeaponId).toBe('axe_t1');
  });

  it('소모품 칸에서는 장착 무기가 나오지 않는다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);

    expect(inventory.equippedWeaponId).toBeUndefined();
  });

  it('소모품을 쓰면 1개 줄고 아이템 정의가 반환된다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);

    expect(inventory.consumeSelected()?.healAmount).toBe(30);
    expect(inventory.slotAt(0)).toEqual({ itemId: 'bandage', count: 1 });
  });

  it('무기는 소모되지 않는다', () => {
    const inventory = new Inventory();
    inventory.add('pistol');

    expect(inventory.consumeSelected()).toBeUndefined();
    expect(inventory.slotAt(0)).toEqual({ itemId: 'pistol', count: 1 });
  });

  it('toView는 복사본을 준다 — 밖에서 고쳐도 내부가 바뀌지 않는다', () => {
    const inventory = new Inventory();
    inventory.add('bandage', 2);

    const view = inventory.toView();
    view.slots[0]!.count = 999;

    expect(inventory.slotAt(0)?.count).toBe(2);
  });
});

describe('itemOfSlot', () => {
  it('빈 칸이면 undefined', () => {
    expect(itemOfSlot(null)).toBeUndefined();
  });

  it('아이템 정의를 돌려준다', () => {
    expect(itemOfSlot({ itemId: 'axe_t1', count: 1 })?.kind).toBe('weapon');
  });
});

describe('World 인벤토리 연동', () => {
  it('참가하면 loadout.json의 시작 지급품을 받는다', () => {
    const world = new World();
    world.addPlayer('p1');
    equipDefaultKit(world, 'p1');

    const inventory = world.getPlayers().get('p1')!.inventory;
    expect(inventory.slotAt(0)?.itemId).toBe('pistol');
    expect(inventory.equippedWeaponId).toBe('pistol');
  });

  it('붕대를 쓰면 체력이 회복된다', () => {
    const world = new World();
    world.addPlayer('p1');
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;
    player.hp = 10;

    world.selectSlot('p1', 3);
    world.useSelectedItem('p1');

    expect(player.hp).toBe(40); // 10 + healAmount 30
    expect(player.inventory.slotAt(3)?.count).toBe(2);
  });

  it('최대 체력을 넘겨 회복하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1');
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;
    player.hp = wavesData.playerHp - 5;

    world.selectSlot('p1', 3);
    world.useSelectedItem('p1');

    expect(player.hp).toBe(wavesData.playerHp);
  });

  it('체력이 가득이면 붕대를 소모하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1');
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;

    world.selectSlot('p1', 3);
    world.useSelectedItem('p1');

    expect(player.inventory.slotAt(3)?.count).toBe(3);
  });

  it('쓰러진 플레이어는 스스로 회복할 수 없다', () => {
    const world = new World();
    world.addPlayer('p1');
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;
    player.hp = 0;

    world.selectSlot('p1', 3);
    world.useSelectedItem('p1');

    expect(player.hp).toBe(0);
    expect(player.inventory.slotAt(3)?.count).toBe(3);
  });

  it('없는 플레이어에 대한 호출은 크래시하지 않는다', () => {
    const world = new World();
    expect(() => world.selectSlot('nobody', 1)).not.toThrow();
    expect(() => world.useSelectedItem('nobody')).not.toThrow();
    expect(() => world.fireWeapon('nobody')).not.toThrow();
  });
});
