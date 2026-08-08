import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { coloniesData, coreUpgradesData, monstersData, resourcesData, wavesData } from '../src/data';
import { HIT_RADIUS } from '../src/sim/combat';
import { COLONY_RADIUS } from '../src/sim/colony';
import { SLOT_COUNT } from '../src/sim/inventory';

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

/**
 * world.ts의 자원 군집 배치 상수(CLUSTER_MIN_DISTANCE/CLUSTER_JITTER_RADIUS, private)를
 * 스폰 최소거리·리스폰 재배치 범위를 검증하는 테스트에서 쓰려고 같은 값으로 미러링한다
 * — 위 worldToCell과 같은 이유(private 상수를 굳이 export하기보단 테스트에서 재구성).
 */
const TEST_CLUSTER_MIN_DISTANCE = 260;
const TEST_CLUSTER_JITTER_RADIUS = 80;
/** world.ts의 STUCK_ESCAPE_DISTANCE(private, docs/backend/42) 미러링 — 탈출 점프가
 * 실제로 일어났는지(제자리걸음이 아닌지) 판단하는 데 쓴다. */
const TEST_STUCK_ESCAPE_DISTANCE = 40;

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
/**
 * 이 파일의 테스트는 대부분 코어에서 멀리 떨어진 좌표(예: (550,500))에 건축물을
 * 짓는다 — 건설 가능 반경(docs/backend/38, `getBuildRadius()`) 자체를 검증하는
 * 테스트가 아니라 충돌/비용/파괴 같은 다른 메커니즘을 보는 테스트라, 반경 제한이
 * 우연히 걸려서 실패하면 안 된다. 티어를 최고 단계로 올려 반경을 사실상 무제한에
 * 가깝게 넉넉히 열어둔다 — `grantSharedResources`가 자원 비용 제약을 없애는 것과
 * 같은 이유의 같은 패턴이다. 반경 제한 자체는 별도 테스트(coreUpgrade.test.ts)에서
 * 검증한다.
 */
function createTestWorld(): World {
  const world = new World({ rng: seededRng(1) });
  const core = world.getCore() as { tier: number };
  // 티어는 startTier에서 시작하므로 최고 단계도 그만큼 밀린다.
  core.tier = coreUpgradesData.startTier + coreUpgradesData.tiers.length;
  // 콜로니는 이제 startColonies()를 명시적으로 불러야 생긴다(docs/backend/41,
  // 인원수가 확정돼야 만들 수 있어서 World 생성자에서 뺐다) — 이 파일의 테스트는
  // 콜로니 "개수"(플레이어 수 연동) 자체엔 관심이 없고 하드 충돌/FlowField 같은
  // 다른 메커니즘을 보므로, 예전과 같은 4개로 채워서 기존 테스트 전제를 유지한다.
  world.startColonies(4);
  // 창고 3번 칸에 붕대 3개를 심어 둔다. 실제 시작 지급품(loadout.coreStorage)은
  // 도구 3종(0=뭉둥이 1=곡괭이 2=도끼)뿐이고 붕대는 개인에게 가지만, 아래 창고
  // 테스트들은 "스택되는 소모품"이 창고에 있어야 스택 합치기/부분 이동을 볼 수 있다.
  world.getCore().storage.add('bandage', 3);
  return world;
}

/** 창고 초기 지급품(도구 3종 + 위에서 심은 붕대) 다음의 첫 빈 칸. */
const FIRST_EMPTY_STORAGE = 4;

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
 * 고정된 4칸 구성(권총/도끼/곡괭이/붕대)을 손에 쥐여준다. 실제 시작 지급품은 창고
 * (loadout.coreStorage)와 붕대 1개뿐이라, 장착을 전제하는 테스트는 여기서 직접 채운다.
 * 슬롯 번호가 고정되어야 selectSlot으로 특정 무기를 지목할 수 있다.
 */
function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  // 참가 지급품(붕대 1개)을 먼저 비운다 — 슬롯 번호를 고정해야 selectSlot 테스트가 성립한다.
  for (let index = 0; index < SLOT_COUNT; index += 1) inventory.takeAt(index);
  inventory.add('handgun', 1);
  inventory.add('axe_t1', 1);
  inventory.add('pickax_t1', 1);
  inventory.add('bandage', 3);
}

/**
 * 참가 지급품(붕대 1개)을 비워 빈손으로 만든다. 인벤토리 칸 수·스택 개수를 세는
 * 테스트는 시작 지급품이 섞이면 전제가 무너진다.
 */
function emptyHands(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  for (let index = 0; index < SLOT_COUNT; index += 1) inventory.takeAt(index);
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

    world.selectSlot('p1', 1); // 도끼 — stone.requiredTool은 'pickax_t1'라 안 맞는다
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
  it('게임 시작 시 창고에 기본 지급품(도구 3종)이 들어 있다', () => {
    const world = createTestWorld();

    expect(storedCount(world, 'bat')).toBe(1);
    expect(storedCount(world, 'axe_t1')).toBe(1);
    expect(storedCount(world, 'pickax_t1')).toBe(1);
  });

  it('참가한 플레이어는 붕대 1개만 받는다(도구는 창고에서 꺼내 쓴다)', () => {
    const world = createTestWorld();
    world.addPlayer('p1');

    const view = world.getPlayers().get('p1')!.inventory.toView();
    expect(view.slots[0]).toEqual({ itemId: 'bandage', count: 1 });
    expect(view.slots.slice(1).every((slot) => slot === null)).toBe(true);
  });

  it('코어 근처에서 창고 칸을 인벤토리 칸으로 끌면 옮겨진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0); // CORE_INTERACT_RADIUS 안

    world.moveItem('p1', 'storage', 0, 'inventory', 1); // 뭉둥이 꺼내기(0번은 붕대)

    expect(storedCount(world, 'bat')).toBe(0);
    expect(world.getPlayers().get('p1')!.inventory.slotAt(1)?.itemId).toBe('bat');
  });

  it('인벤토리 칸을 창고로 끌면 입고된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    world.moveItem('p1', 'storage', 3, 'inventory', 1); // 붕대 3개 꺼내기
    expect(carriedCount(world, 'p1', 'bandage')).toBe(4); // 참가 지급 1개 + 3개

    world.moveItem('p1', 'inventory', 1, 'storage', FIRST_EMPTY_STORAGE);

    expect(carriedCount(world, 'p1', 'bandage')).toBe(1); // 참가 지급분만 남는다
    expect(storedCount(world, 'bandage')).toBe(3);
  });

  it('코어 반경 밖에서는 창고가 얽힌 이동이 거부된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 1000, 0);

    world.moveItem('p1', 'storage', 0, 'inventory', 1);

    expect(storedCount(world, 'bat')).toBe(1);
    expect(world.getPlayers().get('p1')!.inventory.slotAt(1)).toBeNull();
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
    emptyHands(world, 'p1');
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

    world.moveItem('p1', 'inventory', 0, 'storage', 0); // 창고 0번 = 뭉둥이

    expect(inventory.slotAt(0)?.itemId).toBe('bat');
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

    expect(storedCount(world, 'bat')).toBe(1);
  });
});

describe('World — 창고 칸 비우기(폐기)', () => {
  it('칸이 비고 내용물은 발밑에 떨어진다 — 지우지 않아 되돌릴 수 있다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0); // 코어 근접
    emptyHands(world, 'p1');

    const before = storedCount(world, 'bandage'); // 창고 3번 칸에 심어 둔 붕대 3개
    expect(before).toBe(3);

    world.discardFromStorage('p1', 3);

    expect(storedCount(world, 'bandage')).toBe(0);
    expect(droppedCount(world, 'bandage')).toBe(before);
  });

  it('코어에서 멀면 무시된다 — 창고를 만지는 다른 조작과 같은 규칙이다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 1000, 0);

    world.discardFromStorage('p1', 3);

    expect(storedCount(world, 'bandage')).toBe(3);
    expect(droppedCount(world, 'bandage')).toBe(0);
  });

  it('빈 칸이나 이상한 번호를 폐기해도 크래시하지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);

    for (const bad of [-1, 999, 1.5, '1', null, undefined, NaN]) {
      expect(() => world.discardFromStorage('p1', bad)).not.toThrow();
    }
    expect(() => world.discardFromStorage('ghost', 3)).not.toThrow();
    expect(storedCount(world, 'bandage')).toBe(3);
  });
});

describe('World — 쉬프트 클릭 빠른 이동(quickMoveItem, docs/backend/44)', () => {
  it('창고 칸을 쉬프트클릭하면 인벤토리 빈 칸으로 바로 들어간다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0); // CORE_INTERACT_RADIUS 안
    emptyHands(world, 'p1');

    world.quickMoveItem('p1', 'storage', 3); // 창고에 심어둔 붕대 3개

    expect(storedCount(world, 'bandage')).toBe(0);
    expect(carriedCount(world, 'p1', 'bandage')).toBe(3);
  });

  it('인벤토리 칸을 쉬프트클릭하면 창고로 들어가고, 같은 아이템이 있으면 합쳐진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    emptyHands(world, 'p1');
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('bandage', 2);

    world.quickMoveItem('p1', 'inventory', 0);

    expect(carriedCount(world, 'p1', 'bandage')).toBe(0);
    // 창고엔 이미 초기 지급품 붕대 3개가 있다 — 새 칸을 열지 않고 거기 합쳐져 5개(stackSize
    // 5와 정확히 맞아떨어진다).
    expect(storedCount(world, 'bandage')).toBe(5);
  });

  it('목적지가 꽉 차서 일부만 옮겨지면, 옮겨진 만큼만 원래 칸에서 빠지고 나머지는 남는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    emptyHands(world, 'p1');
    const inventory = world.getPlayers().get('p1')!.inventory;
    // 인벤토리(4칸)를 거의 채운다 — 붕대 4개(1칸 남는 여유) + 서로 안 쌓이는
    // 아이템 셋으로 나머지 3칸을 채워서, 총 여유가 "붕대 1개분"만 남게 한다.
    inventory.add('bandage', 4);
    inventory.add('handgun', 1);
    inventory.add('axe_t1', 1);
    inventory.add('pickax_t1', 1);

    world.quickMoveItem('p1', 'storage', 3); // 창고 붕대 3개 시도 — 1개만 들어갈 자리

    expect(carriedCount(world, 'p1', 'bandage')).toBe(5); // 4 + 1 = 스택 꽉 참
    expect(storedCount(world, 'bandage')).toBe(2); // 3개 중 1개만 옮겨졌다 — 2개 남음
  });

  it('목적지가 완전히 꽉 차서 하나도 못 옮기면 원래 칸이 그대로다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    emptyHands(world, 'p1');
    const inventory = world.getPlayers().get('p1')!.inventory;
    // 4칸을 붕대와 안 섞이는 아이템으로 완전히 채운다(스택 여유도 없음).
    inventory.add('handgun', 1);
    inventory.add('axe_t1', 1);
    inventory.add('pickax_t1', 1);
    inventory.add('drop_normal', 1);

    world.quickMoveItem('p1', 'storage', 3); // 창고 붕대 — 들어갈 자리가 전혀 없다

    expect(storedCount(world, 'bandage')).toBe(3); // 그대로
    expect(carriedCount(world, 'p1', 'bandage')).toBe(0);
  });

  it('코어 반경 밖에서는 무시된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 1000, 0);
    emptyHands(world, 'p1');

    world.quickMoveItem('p1', 'storage', 3);

    expect(storedCount(world, 'bandage')).toBe(3);
    expect(carriedCount(world, 'p1', 'bandage')).toBe(0);
  });

  it('빈 칸을 대상으로 하면 아무 일도 일어나지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    emptyHands(world, 'p1');

    world.quickMoveItem('p1', 'inventory', 0); // 인벤토리는 전부 비어 있다

    expect(storedCount(world, 'bat')).toBe(1); // 창고도 그대로
  });

  it('이상한 입력을 보내도 크래시하지 않고 아무것도 사라지지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);

    expect(() => world.quickMoveItem('ghost-player', 'storage', 3)).not.toThrow();
    expect(() => world.quickMoveItem('p1', 'backpack', 3)).not.toThrow();
    for (const bad of [-1, 999, 1.5, '1', null, undefined, NaN]) {
      expect(() => world.quickMoveItem('p1', 'storage', bad)).not.toThrow();
    }

    expect(storedCount(world, 'bandage')).toBe(3);
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

describe('World — 철거(demolishBuilding, docs/backend/43)', () => {
  it('철거하면 건축물이 사라지고, 그 칸에 다시 지을 수 있다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    world.demolishBuilding('builder', cx, cy);
    expect(world.getBuildings().size).toBe(0);

    // 철거된 칸에 다시 지을 수 있다(place가 여전히 "점유됨"으로 보지 않는지 확인).
    world.placeBuilding('builder', 'wall', cx, cy);
    expect(world.getBuildings().size).toBe(1);
    expect([...world.getBuildings().values()][0]!.type).toBe('wall');
  });

  it('철거해도 자원을 돌려주지 않는다(환급 없음)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy); // woodCost=5
    const woodAfterBuild = storedCount(world, 'wood');
    const stoneAfterBuild = storedCount(world, 'stone');

    world.demolishBuilding('builder', cx, cy);

    expect(storedCount(world, 'wood')).toBe(woodAfterBuild); // 안 늘어났다
    expect(storedCount(world, 'stone')).toBe(stoneAfterBuild);
  });

  it('건축물이 없는 칸을 철거해도 아무 일도 일어나지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);

    const { cx, cy } = worldToCell(550, 500);
    world.demolishBuilding('builder', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('존재하지 않는 플레이어나 비정상 좌표는 조용히 무시한다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    world.demolishBuilding('ghost-player', cx, cy);
    world.demolishBuilding('builder', 1.5, cy);
    world.demolishBuilding('builder', NaN, cy);

    expect(world.getBuildings().size).toBe(1); // 그대로 남아있다
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
    // 중간 지점에 벽을 지어야 하므로, 그 중간 지점이 코어 건축 금지 반경(코어가
    // 커지면서 48px) 밖에 오도록 몬스터를 충분히 멀리 둔다.
    monster!.x = 160;
    monster!.y = -120;

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
    equipDefaultKit(world, 'near');
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

    // 예고를 지나 정산까지 — 공격이 "시도 → 예고 → 판정" 3단계라 한 번의 큰 틱으로는
    // 시도만 되고 끝난다(실제 서버는 60Hz라 무관하다).
    for (let i = 0; i < 100; i += 1) world.tick(0.02);

    expect(building!.hp).toBeLessThan(hpBefore);
    // 이동하지 않고 제자리에서 공격했어야 한다.
    expect(monster!.x).toBe(xBefore);
    expect(monster!.y).toBe(yBefore);
  });

  it('공격받은 건축물이 파괴되면 목록에서 사라지고 Flow Field가 다시 열린다', () => {
    const world = createTestWorld();
    world.addPlayer('near', 500, 500);
    equipDefaultKit(world, 'near');
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'blood';
    monster!.x = 0;
    monster!.y = -60; // 코어 사거리(attackRange+CORE_RADIUS=36) 밖 — 코어 대신 건축물부터 공격해야 함

    grantSharedResources(world, 100, 100);
    const { cx, cy } = worldToCell(monster!.x, monster!.y + 10);
    world.placeBuilding('builder', 'fence', cx, cy); // fence hp=50, blood damage=7 → 8번이면 파괴

    for (let i = 0; i < 1200 && world.getBuildings().size > 0; i += 1) {
      world.tick(0.02); // 공격마다 예고를 거치므로 실제 틱에 가깝게 굴린다
    }

    expect(world.getBuildings().size).toBe(0);
  });

  it('추격 타겟이 있어도 사거리 안에 막는 건축물이 있으면 그것부터 공격한다', () => {
    const world = createTestWorld();
    world.addPlayer('target', 300, 0); // aggroRadius(120) 안 (몬스터 기준)
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound'; // aggroRadius 240
    // 코어가 커지면서(반경 40) 원점 근처는 건축 금지라, 무대를 +x로 옮겼다.
    monster!.x = 210;
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

    for (let i = 0; i < 100; i += 1) world.tick(0.02); // 예고 → 정산

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

    // 코어를 벽 고리로 완전히 둘러싼다 — 바깥에서 코어로 가는 경로가 완전히 막힌다.
    // 코어 8각 발자국(가로 ±52px)이 커서, 발자국과 겹치지 않는 가장 가까운 완전한
    // 고리는 체비쇼프 거리 5(11x11 테두리, 40칸)다.
    const coreCell = worldToCell(0, 0);
    let placed = 0;
    for (let dx = -5; dx <= 5; dx += 1) {
      for (let dy = -5; dy <= 5; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 5) continue;
        world.placeBuilding('builder', 'wall', coreCell.cx + dx, coreCell.cy + dy);
        placed += 1;
      }
    }
    expect(placed).toBe(40);
    expect(world.getBuildings().size).toBe(40);

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
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'wall', 550, 500);
    const wall = [...world.getBuildings().values()][0]!;

    world.addPlayer('p1', 500, 500);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(500); // 벽까지는 다가갔다
    expect(player.x).toBeLessThan(wall.x); // 벽을 뚫고 지나가지는 못했다
  });

  it('울타리도 플레이어의 이동을 막는다(통과 불가)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'fence', 550, 500);
    const fence = [...world.getBuildings().values()][0]!;

    world.addPlayer('p1', 500, 500);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(500);
    expect(player.x).toBeLessThan(fence.x);
  });

  it('건축물에 대각선으로 부딪히면 완전히 멈추지 않고 옆으로 미끄러진다(축 슬라이딩)', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    equipDefaultKit(world, 'builder');
    build(world, 'builder', 'wall', 550, 500);
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
    // 코어(발자국 ±52, 건축 금지 여유 포함) 밖에서 쏜다 — 원점 무대는 벽 자리가
    // 금지 셀에 걸리고 총구가 코어에 흡수된다.
    world.addPlayer('shooter', 200, 0);
    equipDefaultKit(world, 'shooter'); // 기본 aimAngle=0 → +x 방향 조준
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');

    grantSharedResources(world, 100, 100);

    // 사수 조준 방향(바로 앞)에 벽을 짓는다.
    const { cx, cy } = worldToCell(260, 0);
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
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('shooter', 200, 0);
    equipDefaultKit(world, 'shooter');
    world.addPlayer('builder', -500, -500);
    equipDefaultKit(world, 'builder');

    grantSharedResources(world, 100, 100);

    const { cx, cy } = worldToCell(260, 0);
    world.placeBuilding('builder', 'fence', cx, cy);
    expect(world.getBuildings().size).toBe(1);

    startFirstWave(world);
    spawnAtLeast(world, 1);
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'blood';
    monster!.x = 350;
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

/**
 * 자원 노드는 군집(클러스터)으로 배치돼서(§backend/26) 첫 번째 노드를 그대로 쓰면
 * 근처(간격 최소 36px)에 다른 노드가 있어 하드 충돌 테스트가 "어느 노드에 막혔는지"
 * 헷갈릴 수 있다 — 클러스터 범위(최대 CLUSTER_MAX_DISTANCE+JITTER≈430) 밖의 완전히
 * 격리된 좌표로 옮겨서 반환한다.
 */
function isolateResourceNode(world: World): { x: number; y: number } {
  const node = [...world.getResourceNodes().values()][0]!;
  node.x = 600;
  node.y = 0;
  return node;
}

describe('World — 자원 노드/콜로니/코어와 플레이어(하드 충돌, docs/backend/38)', () => {
  it('자원 노드는 플레이어의 이동을 막는다(통과 불가)', () => {
    const world = createTestWorld();
    const node = isolateResourceNode(world);
    world.addPlayer('p1', node!.x - 50, node!.y);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(node!.x - 50); // 다가가긴 했다
    expect(player.x).toBeLessThan(node!.x); // 뚫고 지나가지는 못했다
  });

  it('콜로니는 플레이어의 이동을 막는다(통과 불가)', () => {
    const world = createTestWorld();
    const [colony] = [...world.getColonies().values()];
    world.addPlayer('p1', colony!.x - 50, colony!.y);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(colony!.x - 50);
    expect(player.x).toBeLessThan(colony!.x);
  });

  it('코어는 플레이어의 이동을 막는다(통과 불가) — 코어는 항상 원점(0,0)이다', () => {
    const world = createTestWorld();
    // 코어 충돌 반경이 46(플레이어 6 + 코어 40)이라, 그보다 확실히 밖에서 출발한다.
    world.addPlayer('p1', -100, 0);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(-100);
    expect(player.x).toBeLessThan(0);
  });
});

describe('World — 자원 노드/콜로니/코어와 투사체(docs/backend/38)', () => {
  it('자원 노드는 투사체를 막고 피해를 입지 않는다', () => {
    const world = createTestWorld();
    const node = isolateResourceNode(world);
    const hpBefore = node!.hp;
    world.addPlayer('shooter', node!.x - 60, node!.y); // aimAngle 기본 0 → +x 방향 조준
    equipDefaultKit(world, 'shooter');

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    for (let i = 0; i < 30; i += 1) world.tick(0.1);

    expect(world.getProjectiles().size).toBe(0); // 막혀서 소멸했다
    expect(node!.hp).toBe(hpBefore); // 자원 노드는 피해를 입지 않는다(파괴 불가)
  });

  it('콜로니는 투사체를 막고 파괴되지 않는다', () => {
    const world = createTestWorld();
    const [colony] = [...world.getColonies().values()];
    world.addPlayer('shooter', colony!.x - 60, colony!.y);
    equipDefaultKit(world, 'shooter');

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    for (let i = 0; i < 30; i += 1) world.tick(0.1);

    expect(world.getProjectiles().size).toBe(0);
    expect(world.getColonies().get(colony!.id)).toBeDefined(); // 재설계 후 파괴 개념 자체가 없다
  });

  it('코어는 투사체를 막고 피해를 입지 않는다', () => {
    const world = createTestWorld();
    const hpBefore = world.getCore().hp;
    world.addPlayer('shooter', -60, 0);
    equipDefaultKit(world, 'shooter');

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    for (let i = 0; i < 30; i += 1) world.tick(0.1);

    expect(world.getProjectiles().size).toBe(0);
    expect(world.getCore().hp).toBe(hpBefore);
  });
});

describe('World — 자원 노드/콜로니가 몬스터 이동을 막는다(docs/backend/38, docs/backend/40, docs/backend/42)', () => {
  /**
   * 예전엔 `world.tick(1)`처럼 큰 dt 한 번으로 충분했다 — "이미 막힘 반경 안에
   * 있으면 그 자리에서 완전히 멈춘다"는 사전 검사(findBlockingStaticObstacle)가
   * 이동 여부와 무관하게 즉시 얼렸기 때문이다. docs/backend/40에서 목적지 기반
   * 축 슬라이딩(moveMonster, isBlockedForMonster)으로 바뀌면서 큰 dt 한 번은
   * 오히려 장애물을 한 틱에 건너뛰어(터널링) "안 막힌 것처럼" 보이게 만든다 —
   * 투사체/근접 판정에서 이미 겪은 것과 같은 종류의 문제라 같은 해법(dt를
   * 촘촘히 쪼갠다)을 쓴다. 실제 게임은 항상 1/60초 단위로 틱하므로 이건 순전히
   * 테스트 전용 조정이다.
   */
  function tickFinely(world: World, totalSeconds: number): void {
    const steps = Math.round(totalSeconds / 0.01);
    for (let i = 0; i < steps; i += 1) world.tick(0.01);
  }

  it('추격 중인 몬스터가 자원 노드에 막히면(탈출 임계값 전까지는) 공격 없이 그 자리에 멈춘다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const node = isolateResourceNode(world);
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound'; // aggroRadius 240, attackInterval 0.8
    // hellhound(반경6)+노드(반경14)=20px가 실제 충돌 경계 — 15px 앞은 이미 그 안이라
    // 축 슬라이딩으로도 한 발짝도 못 나간다(세 방향 후보 모두 이미 겹친 상태).
    monster!.x = node!.x - 15;
    monster!.y = node!.y;
    monster!.facingX = 1;
    monster!.facingY = 0;

    const player = world.getPlayers().get('p1')!;
    player.x = node!.x + 50; // 노드 너머(65px 떨어짐, 어그로 반경 120 안)
    player.y = node!.y;

    const monsterXBefore = monster!.x;
    const nodeHpBefore = node!.hp;
    const playerHpBefore = player.hp;

    // attackInterval(0.8)은 넘기고도 남지만, docs/backend/42의 탈출 점프 임계값
    // (STUCK_ESCAPE_SECONDS=1)은 아직 안 넘긴 시간 — 탈출 전 "완전히 멈춘다"는
    // 여전히 성립해야 한다(탈출 자체는 아래 별도 테스트에서 검증).
    tickFinely(world, 0.9);

    expect(monster!.x).toBe(monsterXBefore); // 이동하지 않았다
    expect(node!.hp).toBe(nodeHpBefore); // 공격하지도 않았다(파괴 불가)
    expect(player.hp).toBe(playerHpBefore); // 타겟에도 못 미쳤으니 공격 못 함
  });

  it('추격 중인 몬스터가 콜로니에 막히면(탈출 임계값 전까지는) 공격 없이 그 자리에 멈춘다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [colony] = [...world.getColonies().values()];
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound';
    monster!.x = colony!.x - 15;
    monster!.y = colony!.y;
    monster!.facingX = 1;
    monster!.facingY = 0;

    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x + 50;
    player.y = colony!.y;

    const monsterXBefore = monster!.x;

    tickFinely(world, 0.9); // 탈출 점프 임계값(1초) 전까지는 그대로 멈춰 있어야 한다

    expect(monster!.x).toBe(monsterXBefore);
  });

  it('코어로 걸어가는 몬스터는 콜로니가 직선 경로를 막아도 그대로 뚫고 가지 않고 우회한다(Flow Field)', () => {
    const world = createTestWorld();
    startFirstWave(world);

    const [colony] = [...world.getColonies().values()];
    const [monster] = [...world.getMonsters().values()];

    // 콜로니-코어 연장선 위, 콜로니보다 더 바깥쪽에 몬스터를 둔다 — 코어로 가는
    // 직선이 정확히 콜로니를 통과하는 배치다.
    const colonyDistance = Math.hypot(colony!.x, colony!.y);
    const towardCore = { x: -colony!.x / colonyDistance, y: -colony!.y / colonyDistance };
    monster!.x = colony!.x - towardCore.x * 60;
    monster!.y = colony!.y - towardCore.y * 60;

    // 접근하는 내내 콜로니 충돌 반경(COLONY_RADIUS=14px) 안으로는 한 번도 들어가지
    // 않아야 "뚫지 않고 우회했다"고 확신할 수 있다 — 틱 한 번의 방향 벡터만 보면
    // (건축물 우회 테스트처럼) 거리에 따라 편차가 미미해 흔들릴 수 있어서, 대신
    // 실제 이동 궤적 전체에서 최소 거리를 추적한다.
    let minDistanceToColony = Infinity;
    for (let i = 0; i < 500; i += 1) {
      world.tick(0.1);
      const distance = Math.hypot(monster!.x - colony!.x, monster!.y - colony!.y);
      if (distance < minDistanceToColony) minDistanceToColony = distance;
    }

    expect(minDistanceToColony).toBeGreaterThan(14);
  });

  it('코어 자신은 FlowField 목표 셀이라 차단 집합에서 제외된다 — 몬스터가 여전히 코어에 도달해 공격한다', () => {
    const world = createTestWorld();
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 0;
    monster!.y = 0; // 코어 바로 위

    const coreHpBefore = world.getCore().hp;
    for (let i = 0; i < 120; i += 1) world.tick(0.02); // 예고를 지나 정산까지

    expect(world.getCore().hp).toBeLessThan(coreHpBefore);
  });

  it('반경이 큰 몬스터(탱커)도 자원 노드의 실제 충돌 반경 안으로 못 들어간다(docs/backend/39 반경 미포함 버그 수정)', () => {
    const world = createTestWorld();
    startFirstWave(world);

    const node = isolateResourceNode(world);
    const [monster] = [...world.getMonsters().values()];
    // lava_slime hitRadius=9, 자원 노드 hitRadius=14 → 실제로 안 겹치려면 23px는 떨어져야
    // 하는데, 고쳐지기 전엔 attackRange(20px)를 그대로 멈춤 기준으로 써서 3px가
    // 부족한 채로 멈췄다 — 몸집이 작은 타입(HIT_RADIUS=6~9)에서는 안 드러나던 버그다.
    (monster as { type: string }).type = 'lava_slime';
    // 콜로니 우회 테스트(위)와 같은 배치: 몬스터-코어 직선이 노드를 정확히 지나가게
    // 노드보다 바깥쪽에 둔다.
    monster!.x = node!.x + 100;
    monster!.y = node!.y;

    let minDistanceToNode = Infinity;
    for (let i = 0; i < 500; i += 1) {
      world.tick(0.1);
      const distance = Math.hypot(monster!.x - node!.x, monster!.y - node!.y);
      if (distance < minDistanceToNode) minDistanceToNode = distance;
    }

    const combinedRadius = 9 + resourcesData[node!.type].hitRadius; // lava_slime(9) + 노드(14) = 23
    expect(minDistanceToNode).toBeGreaterThan(combinedRadius);
  });

  it('추격 경로가 자원 노드를 대각선으로 스치면 얼어붙지 않고 우회해서 타겟에 도달한다(docs/backend/40)', () => {
    // 몬스터-타겟(플레이어)이 정확히 같은 축(x 또는 y)에 있으면 축 슬라이딩만으로도
    // 충분히 멈춰야 정상이지만(위 두 "그 자리에 멈춘다" 테스트), 실제 추격은 거의
    // 항상 대각선이다 — 이 경우 X축 이동도 Y축 이동도 둘 다 다시 원 안으로 파고드는
    // 상황이 생길 수 있는데(축 슬라이딩만으로는 원형 장애물을 못 돈다), 처음 이
    // 버그를 고치려던 시도는 실제로 이 케이스에서 몬스터가 노드 경계에 영원히
    // 멈춰버렸다(재현 후 접선 미끄러짐 폴백 추가로 해결).
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const node = isolateResourceNode(world); // (600, 0)
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound'; // hitRadius 6, aggroRadius 240
    monster!.x = node!.x - 30;
    monster!.y = node!.y - 40;
    monster!.facingX = 1;
    monster!.facingY = 1;

    const player = world.getPlayers().get('p1')!;
    player.x = node!.x + 30; // 몬스터-플레이어 직선이 노드 중심을 스친다
    player.y = node!.y + 40; // 몬스터로부터 거리 100 — 어그로 반경(120) 안

    let minDistanceToNode = Infinity;
    let reachedPlayer = false;
    for (let i = 0; i < 300 && !reachedPlayer; i += 1) {
      world.tick(0.01);
      const distanceToNode = Math.hypot(monster!.x - node!.x, monster!.y - node!.y);
      if (distanceToNode < minDistanceToNode) minDistanceToNode = distanceToNode;
      if (Math.hypot(monster!.x - player.x, monster!.y - player.y) <= monstersData.hellhound.attackRange) {
        reachedPlayer = true;
      }
    }

    const combinedRadius = 6 + resourcesData[node!.type].hitRadius; // hellhound(6) + 노드(14) = 20
    expect(minDistanceToNode).toBeGreaterThan(combinedRadius - 0.1); // 뚫지 않았다(부동소수 오차 여유)
    expect(reachedPlayer).toBe(true); // 얼어붙지 않고 결국 우회해서 도달했다
  });

  it('자원 노드 여러 개가 촘촘히 둘러싼 "주머니"에 갇혀도 결국 탈출한다(docs/backend/42)', () => {
    // 축 슬라이딩+접선 미끄러짐(docs/backend/40)도 노드 하나 상대로는 잘 통하지만,
    // 노드 여러 개가 촘촘한 고리를 이루면(스크린샷으로 제보된 상황) 모든 방향이
    // 동시에 막혀서 그 자체로는 영원히 못 움직인다 — 실제로 무작위 스트레스
    // 테스트에서 재현됐다. 탈출 점프(STUCK_ESCAPE_SECONDS 이상 갇히면 장애물
    // 반대쪽으로 점프)가 이걸 풀어주는지 확인한다.
    const world = createTestWorld();
    startFirstWave(world);

    const nodes = [...world.getResourceNodes().values()];
    const clusterCenter = { x: 700, y: 0 }; // 코어-군집 연장선 위(코어로 가는 직선이 정확히 관통)
    const ringCount = 6;
    const spacing = 34; // MIN_NODE_SPACING(36)에 가깝게, 촘촘한 고리
    const ringPositions: { x: number; y: number }[] = [];
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (i / ringCount) * Math.PI * 2;
      ringPositions.push({
        x: clusterCenter.x + Math.cos(angle) * spacing,
        y: clusterCenter.y + Math.sin(angle) * spacing,
      });
    }
    for (let i = 0; i < ringPositions.length; i += 1) {
      nodes[i]!.x = ringPositions[i]!.x;
      nodes[i]!.y = ringPositions[i]!.y;
    }
    // 나머지 노드는 멀리 치워서 이 고리와 무관하게 만든다.
    for (let i = ringPositions.length; i < nodes.length; i += 1) {
      nodes[i]!.x = 9000 + i;
      nodes[i]!.y = 9000;
    }

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound'; // hitRadius 6
    // 군집보다 바깥쪽(코어 반대편)에 둬서 코어로 가는 직선이 고리를 정확히 관통하게 한다.
    monster!.x = clusterCenter.x + 200;
    monster!.y = 0;

    const nodeRadius = resourcesData.wood.hitRadius; // wood/stone 둘 다 14
    const monsterR = 6;
    const combinedRadius = monsterR + nodeRadius;

    // 링 경계 바로 앞(막힌 상태)까지 접근한 뒤 "갇힌 지점"을 한 번 기록해 두고,
    // 거기서 탈출 점프(STUCK_ESCAPE_DISTANCE=40px) 절반 넘게 실제로 움직였는지로
    // 판단한다 — 시작 지점에서부터의 거리 같은 간접 지표보다 훨씬 직접적이다.
    let stuckPosition: { x: number; y: number } | undefined;
    let escaped = false;

    for (let i = 0; i < 3600 && !escaped; i += 1) {
      // 최대 60초(탈출 임계값 1초보다 훨씬 넉넉하게)
      world.tick(1 / 60); // 실제 서버 틱레이트 — 탈출 점프도 실제 조건과 같은 dt로 확인

      for (const pos of ringPositions) {
        const distance = Math.hypot(monster!.x - pos.x, monster!.y - pos.y);
        expect(distance).toBeGreaterThanOrEqual(combinedRadius - 0.01); // 탈출 점프 중에도 절대 안 뚫는다
      }

      if (!stuckPosition) {
        const nearAnyNode = ringPositions.some(
          (pos) => Math.hypot(monster!.x - pos.x, monster!.y - pos.y) < combinedRadius + 3,
        );
        if (nearAnyNode) stuckPosition = { x: monster!.x, y: monster!.y };
        continue;
      }

      const movedDistance = Math.hypot(monster!.x - stuckPosition.x, monster!.y - stuckPosition.y);
      if (movedDistance > TEST_STUCK_ESCAPE_DISTANCE / 2) escaped = true;
    }

    expect(stuckPosition).toBeDefined(); // 실제로 링에 막히는 상황까지 재현됐다
    expect(escaped).toBe(true); // 그리고 결국 탈출했다
  });
});

describe('World — 수호대 스폰 위치(docs/backend/40)', () => {
  it('수호대는 콜로니와 겹치지 않는 위치에서 태어나고, 곧바로 움직인다', () => {
    // 예전엔 addMonster(type, colony.x, colony.y)로 콜로니 중심 그대로 스폰시켰다
    // — 콜로니에 하드 충돌이 생긴 뒤로는(docs/backend/38), 스폰된 몬스터가 태어나자마자
    // 이미 자기 자신을 낳은 콜로니와 겹친 상태라 영원히 그 자리에 끼어 있었다.
    const world = createTestWorld();
    const [colony] = [...world.getColonies().values()];
    world.addPlayer('p1', colony!.x + 60, colony!.y); // 트리거 반경 안 → 수호대 소환

    world.tick(coloniesData.guardRespawnSeconds + 0.1);
    expect(world.getMonsters().size).toBeGreaterThan(0);

    const monster = [...world.getMonsters().values()][0]!;
    const monsterR = monstersData[monster.type].hitRadius;
    const distanceToColony = Math.hypot(monster.x - colony!.x, monster.y - colony!.y);
    expect(distanceToColony).toBeGreaterThan(COLONY_RADIUS + monsterR); // 겹치지 않는다

    const spawnX = monster.x;
    const spawnY = monster.y;
    for (let i = 0; i < 50; i += 1) world.tick(0.1); // 5초 — 플레이어를 향해 움직일 시간

    expect(monster.x !== spawnX || monster.y !== spawnY).toBe(true); // 끼어서 멈춰있지 않았다
  });
});

describe('World — 고갈된 자원 노드는 아무것도 막지 않는다(docs/backend/39)', () => {
  it('고갈된 자원 노드는 플레이어의 이동을 막지 않는다', () => {
    const world = createTestWorld();
    const node = isolateResourceNode(world);
    node.hp = 0;
    node.respawnTimer = resourcesData[node.type].respawnSeconds;
    world.addPlayer('p1', node.x - 50, node.y);
    equipDefaultKit(world, 'p1');
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    const player = world.getPlayers().get('p1')!;
    for (let i = 0; i < 300; i += 1) world.tick(0.1);

    expect(player.x).toBeGreaterThan(node.x); // 막히지 않고 뚫고 지나갔다
  });

  it('고갈된 자원 노드는 투사체를 막지 않는다', () => {
    const world = createTestWorld();
    const node = isolateResourceNode(world);
    node.hp = 0;
    node.respawnTimer = resourcesData[node.type].respawnSeconds;
    world.addPlayer('shooter', node.x - 60, node.y); // aimAngle 기본 0 → +x 방향 조준
    equipDefaultKit(world, 'shooter');

    world.fireWeapon('shooter');
    expect(world.getProjectiles().size).toBe(1);

    // 노드(60px 앞)를 지나칠 만큼만 날린다. 무기 사거리 안에서 끝나야 한다 —
    // 사거리를 넘겨 소멸하면 "막혔다"와 구분이 안 된다.
    for (let i = 0; i < 3; i += 1) world.tick(0.1);

    expect(world.getProjectiles().size).toBe(1); // 막혀서 소멸하지 않았다
    const [projectile] = [...world.getProjectiles().values()];
    expect(projectile!.x).toBeGreaterThan(node.x); // 이미 노드를 지나쳤다
  });

  it('고갈된 자원 노드는 몬스터의 이동도 막지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const node = isolateResourceNode(world);
    node.hp = 0;
    node.respawnTimer = resourcesData[node.type].respawnSeconds;
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound'; // aggroRadius 240
    monster!.x = node.x - 15; // 살아있었다면 노드에 막혔을 위치
    monster!.y = node.y;
    monster!.facingX = 1;
    monster!.facingY = 0;

    const player = world.getPlayers().get('p1')!;
    player.x = node.x + 50;
    player.y = node.y;

    const monsterXBefore = monster!.x;

    world.tick(1); // attackInterval을 넘기고도 남을 시간

    expect(monster!.x).not.toBe(monsterXBefore); // 막히지 않고 계속 이동했다
  });
});

describe('World — 자원 노드 리스폰 재배치(docs/backend/39)', () => {
  it('고갈→리스폰되면 원래 좌표가 아닌 같은 군집 안 새 위치로 옮겨간다', () => {
    const world = createTestWorld();
    const [node] = [...world.getResourceNodes().values()];
    const originalX = node!.x;
    const originalY = node!.y;
    const clusterX = node!.clusterX;
    const clusterY = node!.clusterY;

    node!.hp = 0;
    node!.respawnTimer = 0.05; // 다음 틱에 바로 리스폰되게 아주 짧게 잡는다

    world.tick(0.1);

    expect(node!.respawnTimer).toBe(0);
    expect(node!.hp).toBe(resourcesData[node!.type].hp);
    expect(node!.x !== originalX || node!.y !== originalY).toBe(true); // 원래 자리가 아니다
    // 리스폰 위치는 항상 "노드가 속한 군집" 중심(clusterX/Y — 리스폰에도 안 변함) 기준
    // 지터 반경 안이어야 한다.
    const distanceFromClusterCenter = Math.hypot(node!.x - clusterX, node!.y - clusterY);
    expect(distanceFromClusterCenter).toBeLessThanOrEqual(TEST_CLUSTER_JITTER_RADIUS);
  });

  it('리스폰 위치가 군집 중심에 서 있는 플레이어와 겹치지 않는다', () => {
    const world = createTestWorld();
    const [node] = [...world.getResourceNodes().values()];
    const clusterX = node!.clusterX;
    const clusterY = node!.clusterY;

    world.addPlayer('p1', clusterX, clusterY); // 하필 군집 중심에 서 있다

    node!.hp = 0;
    node!.respawnTimer = 0.05;
    world.tick(0.1);

    const player = world.getPlayers().get('p1')!;
    const nodeRadius = resourcesData[node!.type].hitRadius;
    const distance = Math.hypot(node!.x - player.x, node!.y - player.y);
    expect(distance).toBeGreaterThanOrEqual(HIT_RADIUS + nodeRadius);
  });
});

describe('World — 자원 군집 스폰 최소거리(docs/backend/39)', () => {
  it('모든 자원 노드가 코어(원점)에서 최소거리 이상 떨어져 있다', () => {
    const world = createTestWorld();
    // 군집 중심 자체는 항상 TEST_CLUSTER_MIN_DISTANCE 이상 떨어져 있지만, 노드 개별
    // 좌표는 거기서 지터(최대 TEST_CLUSTER_JITTER_RADIUS)만큼 코어 쪽으로 더 붙을 수
    // 있다 — 삼각부등식으로 보장되는 최소값(|중심|-|지터|)을 바닥값으로 검증한다.
    const floor = TEST_CLUSTER_MIN_DISTANCE - TEST_CLUSTER_JITTER_RADIUS;

    for (const node of world.getResourceNodes().values()) {
      const distance = Math.hypot(node.x, node.y);
      expect(distance).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('World — 맨손(기본 무기)', () => {
  it('아무것도 안 들었어도 공격이 성립한다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const node = isolateNode(world, 'wood', 20, 0);
    const hpBefore = node.hp;

    // 인벤토리가 비어 있다 — 예전에는 여기서 아무 일도 일어나지 않았다.
    world.fireWeapon('p1');

    expect(node.hp).toBeLessThan(hpBefore);
  });

  it('맨손은 나무와 돌을 가리지 않고 캔다(도구는 계열이 맞아야 한다)', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const stone = isolateNode(world, 'stone', 20, 0);
    const hpBefore = stone.hp;

    world.fireWeapon('p1'); // 맨손으로 돌

    expect(stone.hp).toBeLessThan(hpBefore);
  });

  it('맨손 데미지는 제대로 된 도구보다 훨씬 낮다', () => {
    const bare = createTestWorld();
    bare.addPlayer('p1', 0, 0);
    const bareNode = isolateNode(bare, 'wood', 20, 0);
    bare.fireWeapon('p1');
    const bareDamage = resourcesData.wood.hp - bareNode.hp;

    const withAxe = createTestWorld();
    withAxe.addPlayer('p1', 0, 0);
    equipDefaultKit(withAxe, 'p1');
    withAxe.selectSlot('p1', 1); // 도끼
    const axeNode = isolateNode(withAxe, 'wood', 20, 0);
    withAxe.fireWeapon('p1');
    const axeDamage = resourcesData.wood.hp - axeNode.hp;

    expect(bareDamage).toBeGreaterThan(0);
    // "매우 약하게" — 도구의 1/3 아래로 둔다. 맨손으로 캐는 게 대안은 되어도
    // 도구를 만들 이유를 없애면 안 된다.
    expect(bareDamage * 3).toBeLessThan(axeDamage);
  });

  it('재료를 들고 있어도 맨손으로 친다(무기가 아니면 손이 빈 것과 같다)', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    world.getPlayers().get('p1')!.inventory.add('wood', 10);
    const node = isolateNode(world, 'wood', 20, 0);
    const hpBefore = node.hp;

    world.fireWeapon('p1');

    expect(node.hp).toBeLessThan(hpBefore);
  });
});
