import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { resourcesData, wavesData } from '../src/data';

/** 1웨이브가 시작될 때까지(day → night) 틱을 진행시킨다. */
function startFirstWave(world: World): void {
  world.tick(wavesData.dayDuration);
  world.tick(0.001);
}

/** 몬스터가 최소 count마리 스폰될 때까지 잘게 쪼개 틱한다. */
function spawnAtLeast(world: World, count: number): void {
  for (let i = 0; i < 5000 && world.getMonsters().size < count; i += 1) {
    world.tick(0.1);
  }
}

/**
 * world.ts의 FLOW_FIELD_GRID와 동일한 값(TILE_SIZE=16, MAP_SIZE_TILES=128)으로 셀
 * 좌표를 계산한다. flowField.test.ts가 자체 GRID 상수를 갖는 것과 같은 이유로, World가
 * private로 감춘 그리드 상수를 테스트에서 재구성한다.
 */
const TILE_SIZE = 16;
const MAP_SIZE_TILES = 128;
const GRID_ORIGIN = -(MAP_SIZE_TILES * TILE_SIZE) / 2;
function worldToCell(x: number, y: number): { cx: number; cy: number } {
  return {
    cx: Math.floor((x - GRID_ORIGIN) / TILE_SIZE),
    cy: Math.floor((y - GRID_ORIGIN) / TILE_SIZE),
  };
}

/** 매번 같은 시퀀스를 내는 결정론적 rng — wave.test.ts와 동일 패턴(테스트 재현성용). */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * 자원 노드 배치(docs/backend/26)가 RNG 기반 군집 배치로 바뀌면서, `new World()`를
 * 기본값(Math.random)으로 그냥 쓰면 매 테스트 실행마다 다른 위치가 나온다 — 이 파일의
 * 여러 테스트가 고정 좌표(예: (550,500))에 건축물을 짓는데, 극히 낮은 확률이라도 그
 * 좌표에 자원 노드가 우연히 겹치면 테스트가 간헐적으로 실패할 수 있다. 시드를 고정해서
 * 이 파일의 모든 테스트가 완전히 결정론적인 배치를 쓰게 한다.
 */
function createTestWorld(): World {
  return new World({ rng: seededRng(1) });
}

/**
 * 건축 비용은 코어 창고에서 나간다(개인 인벤토리가 아니다) — 테스트에서 직접 채워
 * 넣는다. 자원이 전용 숫자 필드가 아니라 창고 슬롯이 된 뒤로는 add()로 넣는다.
 */
function grantSharedResources(world: World, wood: number, stone: number): void {
  const storage = world.getCore().storage;
  if (wood > 0) storage.add('wood', wood);
  if (stone > 0) storage.add('stone', stone);
}

/** 창고에 든 특정 재료 개수. 예전 core.sharedWood를 대신한다. */
function storedCount(world: World, itemId: string): number {
  return world.getCore().storage.countOf(itemId);
}

/** 인벤토리 전체에서 특정 아이템 개수(여러 칸에 나뉘어 있을 수 있다). */
function carriedCount(world: World, playerId: string, itemId: string): number {
  const view = world.getPlayers().get(playerId)!.inventory.toView();
  return view.slots.reduce((sum, slot) => (slot?.itemId === itemId ? sum + slot.count : sum), 0);
}

/** 바닥에 떨어진 특정 아이템 개수. */
function droppedCount(world: World, itemId: string): number {
  let total = 0;
  for (const drop of world.getDroppedItems().values()) {
    if (drop.itemId === itemId) total += drop.count;
  }
  return total;
}

/**
 * 클러스터 자동 배치 위치를 그대로 쓰면 반경 안에 같은 타입의 다른 노드가 더
 * 있을 수 있어(§backend/26) 어느 노드가 맞았는지 헷갈린다 — 타겟 노드만 플레이어
 * 코앞(+x, 도끼/곡괭이 사거리 26px 안)으로 옮기고 나머지 같은 타입 노드는 멀리
 * 치워서 완전히 격리한다.
 */
function isolateNode(world: World, type: 'wood' | 'stone', x: number, y: number) {
  const nodes = [...world.getResourceNodes().values()];
  const target = nodes.find((n) => n.type === type)!;
  for (const node of nodes) {
    if (node === target) continue;
    if (node.type === type) {
      node.x = 5000;
      node.y = 5000;
    }
  }
  target.x = x;
  target.y = y;
  return target;
}

/**
 * 예전 시작 지급품(권총/도끼/곡괭이/붕대)을 손에 쥐여준다. 이제 도구는 팀 창고에서
 * 시작하므로(loadout.coreStorage), 장착을 전제하는 테스트는 명시적으로 꺼내 쓴다.
 * 슬롯 순서는 예전과 같아서 기존 selectSlot 번호가 그대로 유효하다.
 */
function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  inventory.add('pistol', 1);
  inventory.add('axe', 1);
  inventory.add('pickax', 1);
  inventory.add('bandage', 3);
}

describe('World — 채집(근접 타격)', () => {

  it('맞는 도구(도끼)로 나무 노드를 때리면 체력이 깎이고, 고갈되면 자원을 얻는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'wood', 20, 0);

    world.selectSlot('p1', 1); // loadout 순서: 0=권총 1=도끼 2=곡괭이 3=붕대
    const player = world.getPlayers().get('p1')!;

    // wood.hp=54, axe.damage=18 → 정확히 3타에 고갈된다.
    world.fireWeapon('p1');
    world.tick(1); // axe fireRate(1.5) 쿨다운을 넘긴다
    expect(node.hp).toBe(36);
    expect(droppedCount(world, 'wood')).toBe(0); // 아직 고갈 전이라 아무것도 안 떨어진다

    world.fireWeapon('p1');
    world.tick(1);
    expect(node.hp).toBe(18);

    world.fireWeapon('p1');

    expect(node.hp).toBe(0);
    expect(node.respawnTimer).toBe(resourcesData.wood.respawnSeconds);
    // 고갈 순간 지갑이 아니라 **바닥에** 떨어진다 — 줍는 건 별도 행동이다.
    expect(droppedCount(world, 'wood')).toBe(resourcesData.wood.yieldOnDeplete);
    expect(carriedCount(world, 'p1', 'wood')).toBe(0);
    expect(player.hp).toBeGreaterThan(0);
  });

  it('도구가 맞지 않으면(도끼로 돌) 데미지가 들어가지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'stone', 20, 0);
    const before = node.hp;

    world.selectSlot('p1', 1); // 도끼 — stone.requiredTool은 'pickax'라 안 맞는다
    world.fireWeapon('p1');

    expect(node.hp).toBe(before);
  });

  it('사거리 밖 노드는 근접 공격이 닿지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'wood', 5000, 0);
    const before = node.hp;

    world.selectSlot('p1', 1);
    world.fireWeapon('p1');

    expect(node.hp).toBe(before);
  });

  it('고갈된 노드는 공격해도 반응이 없고, respawnSeconds 후에 hp가 원상복구된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'stone', 20, 0);
    node.hp = 0;
    node.respawnTimer = resourcesData.stone.respawnSeconds;

    world.selectSlot('p1', 2); // 곡괭이
    world.fireWeapon('p1');
    expect(droppedCount(world, 'stone')).toBe(0); // 고갈된 노드를 때려도 안 떨어진다

    for (let i = 0; i < 200 && node.respawnTimer > 0; i += 1) {
      world.tick(1);
    }
    expect(node.respawnTimer).toBe(0);
    expect(node.hp).toBe(resourcesData.stone.hp);
  });
});

describe('World — 드롭 줍기', () => {
  it('반경 안의 드롭을 주우면 인벤토리로 들어오고 바닥에서 사라진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'wood', 20, 0);
    node.hp = resourcesData.wood.hp;

    world.selectSlot('p1', 1); // 도끼
    for (let i = 0; i < 3; i += 1) {
      world.fireWeapon('p1');
      world.tick(1);
    }
    expect(droppedCount(world, 'wood')).toBe(resourcesData.wood.yieldOnDeplete);

    // 시작 지급품이 4칸을 다 채우므로 한 칸 비워야 들어갈 자리가 생긴다.
    world.getPlayers().get('p1')!.inventory.removeAt(3, 99);

    // 드롭은 노드 자리에 떨어진다 — 그 옆으로 가서 줍는다.
    world.getPlayers().get('p1')!.x = 20;
    world.pickUpNearestDrop('p1');

    expect(carriedCount(world, 'p1', 'wood')).toBe(resourcesData.wood.yieldOnDeplete);
    expect(droppedCount(world, 'wood')).toBe(0);
  });

  it('멀리 있는 드롭은 주워지지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const node = isolateNode(world, 'wood', 20, 0);
    node.hp = resourcesData.wood.hp;

    world.selectSlot('p1', 1);
    for (let i = 0; i < 3; i += 1) {
      world.fireWeapon('p1');
      world.tick(1);
    }

    world.getPlayers().get('p1')!.x = 5000;
    world.pickUpNearestDrop('p1');

    expect(carriedCount(world, 'p1', 'wood')).toBe(0);
    expect(droppedCount(world, 'wood')).toBeGreaterThan(0);
  });

  it('인벤토리가 꽉 차면 들어간 만큼만 줄고 나머지는 바닥에 남는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;

    // 시작 지급품이 4칸을 모두 채운 상태(권총/도끼/곡괭이/붕대) — 나무가 들어갈 칸이 없다.
    const node = isolateNode(world, 'wood', 20, 0);
    node.hp = resourcesData.wood.hp;
    world.selectSlot('p1', 1);
    for (let i = 0; i < 3; i += 1) {
      world.fireWeapon('p1');
      world.tick(1);
    }

    player.x = 20;
    world.pickUpNearestDrop('p1');

    // 한 개도 못 넣었으므로 바닥 드롭이 그대로다 — 조용히 증발하지 않는다.
    expect(carriedCount(world, 'p1', 'wood')).toBe(0);
    expect(droppedCount(world, 'wood')).toBe(resourcesData.wood.yieldOnDeplete);
  });

  it('없는 플레이어가 주우려 해도 크래시하지 않는다', () => {
    const world = createTestWorld();
    expect(() => world.pickUpNearestDrop('nobody')).not.toThrow();
  });
});

describe('World — 코어 창고(moveItem)', () => {
  /** 창고 초기 지급품(권총/도끼/곡괭이/붕대) 때문에 첫 빈 칸은 4번부터다. */
  const FIRST_EMPTY_STORAGE = 4;

  it('게임 시작 시 창고에 기본 지급품이 들어 있다', () => {
    const world = createTestWorld();

    expect(storedCount(world, 'pistol')).toBe(1);
    expect(storedCount(world, 'axe')).toBe(1);
    expect(storedCount(world, 'pickax')).toBe(1);
    expect(storedCount(world, 'bandage')).toBe(3);
  });

  it('참가한 플레이어의 인벤토리는 비어 있다(도구는 창고에서 꺼내 쓴다)', () => {
    const world = createTestWorld();
    world.addPlayer('p1');

    const view = world.getPlayers().get('p1')!.inventory.toView();
    expect(view.slots.every((slot) => slot === null)).toBe(true);
  });

  it('코어 근처에서 창고 칸을 인벤토리 칸으로 끌면 옮겨진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0); // CORE_INTERACT_RADIUS 안

    world.moveItem('p1', 'storage', 0, 'inventory', 0); // 권총 꺼내기

    expect(storedCount(world, 'pistol')).toBe(0);
    expect(world.getPlayers().get('p1')!.inventory.slotAt(0)?.itemId).toBe('pistol');
  });

  it('인벤토리 칸을 창고로 끌면 입고된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    world.moveItem('p1', 'storage', 3, 'inventory', 0); // 붕대 3개 꺼내기
    expect(carriedCount(world, 'p1', 'bandage')).toBe(3);

    world.moveItem('p1', 'inventory', 0, 'storage', FIRST_EMPTY_STORAGE);

    expect(carriedCount(world, 'p1', 'bandage')).toBe(0);
    expect(storedCount(world, 'bandage')).toBe(3);
  });

  it('코어 반경 밖에서는 창고가 얽힌 이동이 거부된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 1000, 0);

    world.moveItem('p1', 'storage', 0, 'inventory', 0);

    expect(storedCount(world, 'pistol')).toBe(1);
    expect(world.getPlayers().get('p1')!.inventory.slotAt(0)).toBeNull();
  });

  it('인벤토리 내부 재배치는 코어에서 멀어도 된다(퀵슬롯 순서 바꾸기)', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 1000, 0);
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('bandage', 2);

    world.moveItem('p1', 'inventory', 0, 'inventory', 3);

    expect(inventory.slotAt(0)).toBeNull();
    expect(inventory.slotAt(3)?.itemId).toBe('bandage');
  });

  it('같은 아이템 위에 놓으면 스택이 합쳐진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('bandage', 2);

    world.moveItem('p1', 'inventory', 0, 'storage', 3); // 창고 3번 = 붕대 3개

    expect(storedCount(world, 'bandage')).toBe(5);
    expect(carriedCount(world, 'p1', 'bandage')).toBe(0);
  });

  it('다른 아이템 위에 놓으면 자리를 바꾼다(사라지지 않는다)', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('bandage', 2);

    world.moveItem('p1', 'inventory', 0, 'storage', 0); // 창고 0번 = 권총

    expect(inventory.slotAt(0)?.itemId).toBe('pistol');
    expect(world.getCore().storage.slotAt(0)?.itemId).toBe('bandage');
  });

  it('이상한 입력을 보내도 크래시하지 않고 아무것도 사라지지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);

    for (const bad of [-1, 999, 1.5, '1', null, undefined, NaN]) {
      expect(() => world.moveItem('p1', 'storage', bad, 'inventory', 0)).not.toThrow();
      expect(() => world.moveItem('p1', 'inventory', 0, 'storage', bad)).not.toThrow();
    }
    expect(() => world.moveItem('p1', 'backpack', 0, 'inventory', 0)).not.toThrow();

    expect(storedCount(world, 'pistol')).toBe(1);
  });
});

describe('World — 건축', () => {
  it('공유 자원이 충분하면 빈 셀에 건축물을 지을 수 있고 비용이 공유 풀에서 차감된다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 10, 10);

    // 본인이 서 있는 셀이 아니라 바로 옆 셀에 짓는다 — "플레이어가 서 있는 셀엔 못 짓는다"
    // 규칙은 배치를 요청한 본인에게도 적용된다(실제 게임에서도 자기 발밑이 아니라
    // 앞쪽 빈 자리에 짓는 게 자연스럽다).
    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);

    // fence woodCost=5, stoneCost=0 → 나무만 5개 빠진다(10 - 5 = 5 남음)
    expect(storedCount(world, 'wood')).toBe(5);
    expect(storedCount(world, 'stone')).toBe(10);

    const buildings = [...world.getBuildings().values()];
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.type).toBe('fence');
  });

  it('공유 자원이 부족하면 건축이 실패하고 아무것도 차감되지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 0, 0);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'wall', cx, cy);

    expect(world.getBuildings().size).toBe(0);
    expect(storedCount(world, 'wood')).toBe(0);
    expect(storedCount(world, 'stone')).toBe(0);
  });

  it('이미 건축물이 있는 셀엔 다시 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);
    world.placeBuilding('builder', 'fence', cx, cy); // 같은 셀 재시도

    expect(world.getBuildings().size).toBe(1);
  });

  it('코어가 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(0, 0);
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('자원 노드가 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const [node] = [...world.getResourceNodes().values()];
    const { cx, cy } = worldToCell(node.x, node.y);
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('플레이어가 서 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(500, 500); // builder 본인이 서 있는 셀
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('존재하지 않는 건축물 타입이나 비정상 좌표는 조용히 무시한다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    world.placeBuilding('builder', 'castle', 10, 10);
    world.placeBuilding('builder', 'fence', 1.5, 10);
    world.placeBuilding('builder', 'fence', -1, 10);
    world.placeBuilding('builder', 'fence', 9999, 10);
    world.placeBuilding('builder', 'fence', NaN, 10);

    expect(world.getBuildings().size).toBe(0);
  });
});

describe('World — 건축물과 몬스터 상호작용', () => {
  it('건축물을 설치하면 직선 경로가 막힌 몬스터의 이동 방향이 바뀐다(Flow Field 재계산)', () => {
    const world = createTestWorld();
    world.addPlayer('near', 500, 500); // 몬스터 어그로에서 멀리 둔다
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);
    spawnAtLeast(world, 1);

    // 코어(원점)와 대칭축(x=0 등) 위에 두면 장애물 하나가 좌우를 똑같이 막아서
    // 그라디언트의 수평 성분이 우연히 0으로 상쇄될 수 있다 — 일부러 비대칭 위치를 쓴다.
    const [monster] = [...world.getMonsters().values()];
    monster!.x = 80;
    monster!.y = -60;

    world.tick(0.001);
    const directionBefore = { x: monster!.facingX, y: monster!.facingY };

    // 몬스터와 코어를 잇는 직선의 중간 지점에 벽을 짓는다.
    grantSharedResources(world, 100, 100);
    const { cx, cy } = worldToCell(monster!.x / 2, monster!.y / 2);
    world.placeBuilding('builder', 'wall', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    world.tick(0.001);
    const directionAfter = { x: monster!.facingX, y: monster!.facingY };

    // 방향이 눈에 띄게 바뀌었는지(내적이 1에서 충분히 멀어졌는지)로 판정한다 — 특정
    // 축의 부호를 못박지 않아야 배치를 조금 바꿔도 테스트가 깨지지 않는다.
    const dot = directionBefore.x * directionAfter.x + directionBefore.y * directionAfter.y;
    expect(dot).toBeLessThan(0.999);
  });

  it('사거리 안에 이동을 막는 건축물이 있으면 몬스터가 이동 대신 그것을 공격한다', () => {
    const world = createTestWorld();
    world.addPlayer('near', 500, 500);
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 0;
    monster!.y = -100;

    grantSharedResources(world, 100, 100);
    // 몬스터 코앞(사거리 20 안)에 벽을 짓는다.
    const { cx, cy } = worldToCell(monster!.x, monster!.y + 10);
    world.placeBuilding('builder', 'wall', cx, cy);
    const [building] = [...world.getBuildings().values()];
    expect(building).toBeDefined();

    const xBefore = monster!.x;
    const yBefore = monster!.y;
    const hpBefore = building!.hp;

    world.tick(1); // attackInterval(1초)을 넘기도록

    expect(building!.hp).toBeLessThan(hpBefore);
    // 이동하지 않고 제자리에서 공격했어야 한다.
    expect(monster!.x).toBe(xBefore);
    expect(monster!.y).toBe(yBefore);
  });

  it('공격받은 건축물이 파괴되면 목록에서 사라지고 Flow Field가 다시 열린다', () => {
    const world = createTestWorld();
    world.addPlayer('near', 500, 500);
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'trash';
    monster!.x = 0;
    monster!.y = -60; // 코어 사거리(attackRange+CORE_RADIUS=36) 밖 — 코어 대신 건축물부터 공격해야 함

    grantSharedResources(world, 100, 100);
    const { cx, cy } = worldToCell(monster!.x, monster!.y + 10);
    world.placeBuilding('builder', 'fence', cx, cy); // fence hp=50, trash damage=5 → 10번이면 파괴

    for (let i = 0; i < 20 && world.getBuildings().size > 0; i += 1) {
      world.tick(1);
    }

    expect(world.getBuildings().size).toBe(0);
  });

  it('추격 타겟이 있어도 사거리 안에 막는 건축물이 있으면 그것부터 공격한다', () => {
    const world = createTestWorld();
    world.addPlayer('target', 100, 0); // aggroRadius(120) 안
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher'; // aggroRadius 120
    monster!.x = 10;
    monster!.y = 0;
    monster!.facingX = 1; // target(200,0) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05);
    expect(monster!.targetPlayerId).toBe('target'); // 타겟 획득 확인

    grantSharedResources(world, 100, 100);
    // 몬스터와 타겟 사이, 몬스터 사거리(20) 안에 벽을 짓는다.
    const { cx, cy } = worldToCell(monster!.x + 12, monster!.y);
    world.placeBuilding('builder', 'wall', cx, cy);
    const [building] = [...world.getBuildings().values()];
    expect(building).toBeDefined();
    const hpBefore = building!.hp;
    const xBefore = monster!.x;

    world.tick(1);

    expect(building!.hp).toBeLessThan(hpBefore);
    expect(monster!.x).toBe(xBefore); // 플레이어를 향해 이동하지 않고 벽을 공격했다
  });

  it('코어를 건축물로 완전히 둘러싸도 몬스터가 멈추지 않고 결국 건축물을 공격한다', () => {
    // 회귀 테스트: Flow Field가 코어로의 경로를 아예 못 찾으면(둘러싸여서 도달 불가)
    // sampleDirection이 항상 {0,0}을 돌려줘서 몬스터가 그 자리에 영원히 멈춰 섰던 버그.
    const world = createTestWorld();
    world.addPlayer('near', 2000, 2000); // 몬스터 어그로에서 멀리 둔다
    world.addPlayer('builder', -2000, -2000);
    equipDefaultKit(world, 'builder');

    grantSharedResources(world, 1000, 1000);

    // 코어를 둘러싼 8칸 전부에 벽을 짓는다 — 바깥에서 코어로 가는 경로가 완전히 막힌다.
    const coreCell = worldToCell(0, 0);
    const neighborOffsets = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (const [dx, dy] of neighborOffsets) {
      world.placeBuilding('builder', 'wall', coreCell.cx + dx, coreCell.cy + dy);
    }
    expect(world.getBuildings().size).toBe(8);

    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 200;
    monster!.y = 0;
    const initialX = monster!.x;

    const coreHpBefore = world.getCore().hp;

    // 몬스터가 제자리에 멈춰 있지 않고 벽까지 다가가서 공격을 시작하는지 확인한다.
    let anyBuildingDamaged = false;
    for (let i = 0; i < 300 && !anyBuildingDamaged; i += 1) {
      world.tick(1);
      for (const building of world.getBuildings().values()) {
        if (building.hp < building.maxHp) anyBuildingDamaged = true;
      }
    }

    expect(anyBuildingDamaged).toBe(true);
    expect(monster!.x).not.toBe(initialX); // 완전히 멈춰 있지 않았다
    // 회귀 테스트: 몬스터가 raw 거리만으로 "코어 사거리 안"을 통과해서 벽을 무시하고
    // 코어를 직접 공격해버리던 버그(막는 건축물 검사보다 타겟/코어 사거리 검사가
    // 먼저였음) — 벽이 멀쩡히 남아있는 동안은 코어가 전혀 깎이면 안 된다.
    expect(world.getCore().hp).toBe(coreHpBefore);
  });
});

describe('World — 건축물과 플레이어', () => {
  function build(world: World, playerId: string, type: 'fence' | 'wall', x: number, y: number): void {
    grantSharedResources(world, 100, 100);
    const { cx, cy } = worldToCell(x, y);
    world.placeBuilding(playerId, type, cx, cy);
  }

  it('벽은 플레이어의 이동을 막는다(통과 불가)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 800, 800);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'wall', 850, 800);
    const wall = [...world.getBuildings().values()][0]!;

    world.addPlayer('p1', 800, 800);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(800); // 벽까지는 다가갔다
    expect(player.x).toBeLessThan(wall.x); // 벽을 뚫고 지나가지는 못했다
  });

  it('울타리도 플레이어의 이동을 막는다(통과 불가)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 800, 800);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'fence', 850, 800);
    const fence = [...world.getBuildings().values()][0]!;

    world.addPlayer('p1', 800, 800);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(800);
    expect(player.x).toBeLessThan(fence.x);
  });

  it('건축물에 대각선으로 부딪히면 완전히 멈추지 않고 옆으로 미끄러진다(축 슬라이딩)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 800, 800);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'wall', 850, 800);
    const wall = [...world.getBuildings().values()][0]!;

    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    const player = world.getPlayers().get('p1')!;
    // 충돌 반경(HIT_RADIUS 10 + TILE_SIZE/2 8 = 18px)보다 살짝 밖인 x축 20px
    // 지점에 세운다 — 대각선 한 스텝을 내디디면 전체 이동(x+y)은 반경 안으로 들어가
    // 막히지만, y축 단독 이동은 반경 밖에 머물러 계속 허용돼야 한다.
    player.x = wall.x - 20;
    player.y = wall.y;

    world.setInput('p1', { seq: 1, moveX: 1, moveY: 1, aimAngle: 0 });
    world.tick(0.1);

    expect(player.x).toBeCloseTo(wall.x - 20); // x축 이동은 막혔다
    expect(player.y).toBeGreaterThan(wall.y); // y축 이동은 막히지 않고 미끄러졌다
  });
});

describe('World — 건축물과 투사체', () => {
  it('벽은 투사체를 막고 통과시키지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('shooter', 0, 0);
    equipDefaultKit(world, 'shooter'); // 기본 aimAngle=0 → +x 방향 조준
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');

    grantSharedResources(world, 100, 100);

    // 사수 조준 방향(바로 앞)에 벽을 짓는다.
    const { cx, cy } = worldToCell(60, 0);
    world.placeBuilding('builder', 'wall', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    // 투사체가 벽을 지나칠 시간을 넉넉히 준다(pistol projectileSpeed=420px/s).
    for (let i = 0; i < 20; i += 1) world.tick(0.1);

    expect(world.getProjectiles().size).toBe(0);
  });

  it('울타리는 투사체를 막지 않고 통과시킨다', () => {
    const world = createTestWorld();
    world.addPlayer('shooter', 0, 0);
    equipDefaultKit(world, 'shooter');
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');

    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(60, 0);
    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    startFirstWave(world);
    spawnAtLeast(world, 1);
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'trash';
    monster!.x = 150;
    monster!.y = 0;
    monster!.hp = monster!.maxHp;

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    // 투사체(420px/s)가 울타리(x≈60)를 지나 몬스터(x=150)까지 닿을 시간을 준다 — 짧게
    // 잡아서 몬스터가 코어 쪽으로 너무 많이 걸어와 버리지 않게 한다. dt를 촘촘히
    // 쪼갠 이유: 무기에 muzzleOffset이 붙으면서 투사체 시작 위치가 살짝 밀렸는데,
    // 그 상태에서 dt=0.1(틱당 42px 이동)로 크게 쪼개면 마침 몬스터도 코어 쪽으로
    // 다가오고 있어서 두 좌표가 같은 틱에 겹치는 순간 없이 서로를 "건너뛸" 수 있다
    // (한 틱 전엔 13px 차이로 아깝게 빗나가고, 다음 틱엔 이미 지나쳐버림). dt=0.01
    // (틱당 4.2px)로 쪼개면 몬스터 반경(HIT_RADIUS=10px)보다 훨씬 촘촘해서 이런
    // "터널링"이 나올 수 없다.
    for (let i = 0; i < 80; i += 1) world.tick(0.01);

    expect(monster!.hp).toBeLessThan(monster!.maxHp); // 울타리를 통과해서 맞았다
  });
});
