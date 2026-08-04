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

describe('World — 채집', () => {
  it('반경 안의 자원 노드를 채집하면 인벤토리가 늘고 노드 잔여 횟수가 준다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    const [node] = [...world.getResourceNodes().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = node.x;
    player.y = node.y;

    const before = node.remainingHarvests;
    world.harvest('p1');

    expect(node.remainingHarvests).toBe(before - 1);
    if (node.type === 'wood') expect(player.wood).toBeGreaterThan(0);
    else expect(player.stone).toBeGreaterThan(0);
  });

  it('harvestInterval 안에 다시 채집을 시도하면 무시된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    const [node] = [...world.getResourceNodes().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = node.x;
    player.y = node.y;

    const before = node.remainingHarvests;
    world.harvest('p1');
    const afterFirst = node.type === 'wood' ? player.wood : player.stone;
    world.harvest('p1'); // 같은 틱, 쿨다운 안 지남

    const afterSecond = node.type === 'wood' ? player.wood : player.stone;
    expect(afterSecond).toBe(afterFirst);
    expect(node.remainingHarvests).toBe(before - 1); // 정확히 1번만 채집됐어야 한다
  });

  it('반경 밖에서는 채집이 되지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 5000, 5000); // 어떤 노드와도 멀리 떨어진 위치

    const [node] = [...world.getResourceNodes().values()];
    const before = node.remainingHarvests;

    world.harvest('p1');

    expect(node.remainingHarvests).toBe(before);
  });

  it('고갈된 노드는 채집되지 않고, respawnSeconds 후에 다시 채집 가능해진다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    const [node] = [...world.getResourceNodes().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = node.x;
    player.y = node.y;

    // 노드가 군집으로 배치돼서 반경 안에 같은 타입의 다른 노드가 더 있을 수 있다 —
    // harvest()를 반복 호출해 "이 노드"만 자연스럽게 고갈시키는 방식은 그 다른 노드를
    // 대신 캐버릴 수 있어 더 이상 안전하지 않다. 직접 고갈 상태로 만들어서
    // "고갈된 노드는 후보에서 제외된다"를 확실히 검증한다(반경 안 전부 고갈시킴).
    for (const other of world.getResourceNodes().values()) {
      other.remainingHarvests = 0;
    }
    node.respawnTimer = resourcesData[node.type].respawnSeconds;

    const stockBefore = node.type === 'wood' ? player.wood : player.stone;
    world.harvest('p1');
    const stockAfterFailedTry = node.type === 'wood' ? player.wood : player.stone;
    expect(stockAfterFailedTry).toBe(stockBefore);

    // 리스폰 타이머를 다 흘려보내면 다시 채집 가능해진다.
    for (let i = 0; i < 200 && node.respawnTimer > 0; i += 1) {
      world.tick(1);
    }
    expect(node.respawnTimer).toBe(0);
    expect(node.remainingHarvests).toBeGreaterThan(0);
  });
});

describe('World — 건축', () => {
  function grantResources(world: World, playerId: string, wood: number, stone: number): void {
    const player = world.getPlayers().get(playerId)!;
    player.wood = wood;
    player.stone = stone;
  }

  it('자원이 충분하면 빈 셀에 건축물을 지을 수 있고 비용이 차감된다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 10, 10);

    // 본인이 서 있는 셀이 아니라 바로 옆 셀에 짓는다 — "플레이어가 서 있는 셀엔 못 짓는다"
    // 규칙은 배치를 요청한 본인에게도 적용된다(실제 게임에서도 자기 발밑이 아니라
    // 앞쪽 빈 자리에 짓는 게 자연스럽다).
    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);

    const player = world.getPlayers().get('builder')!;
    expect(player.wood).toBe(5); // fence woodCost=5
    expect(player.stone).toBe(10); // fence stoneCost=0

    const buildings = [...world.getBuildings().values()];
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.type).toBe('fence');
  });

  it('자원이 부족하면 건축이 실패하고 아무것도 차감되지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 0, 0);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'wall', cx, cy);

    expect(world.getBuildings().size).toBe(0);
    const player = world.getPlayers().get('builder')!;
    expect(player.wood).toBe(0);
    expect(player.stone).toBe(0);
  });

  it('이미 건축물이 있는 셀엔 다시 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 100, 100);

    const { cx, cy } = worldToCell(550, 500);
    world.placeBuilding('builder', 'fence', cx, cy);
    world.placeBuilding('builder', 'fence', cx, cy); // 같은 셀 재시도

    expect(world.getBuildings().size).toBe(1);
  });

  it('코어가 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 100, 100);

    const { cx, cy } = worldToCell(0, 0);
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('자원 노드가 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 100, 100);

    const [node] = [...world.getResourceNodes().values()];
    const { cx, cy } = worldToCell(node.x, node.y);
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('플레이어가 서 있는 셀엔 지을 수 없다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 100, 100);

    const { cx, cy } = worldToCell(500, 500); // builder 본인이 서 있는 셀
    world.placeBuilding('builder', 'fence', cx, cy);

    expect(world.getBuildings().size).toBe(0);
  });

  it('존재하지 않는 건축물 타입이나 비정상 좌표는 조용히 무시한다', () => {
    const world = createTestWorld();
    world.addPlayer('builder', 500, 500);
    grantResources(world, 'builder', 100, 100);

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
    const grantAndBuild = world.getPlayers().get('builder')!;
    grantAndBuild.wood = 100;
    grantAndBuild.stone = 100;
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
    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 0;
    monster!.y = -100;

    const grantAndBuild = world.getPlayers().get('builder')!;
    grantAndBuild.wood = 100;
    grantAndBuild.stone = 100;
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
    startFirstWave(world);
    spawnAtLeast(world, 1);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'trash';
    monster!.x = 0;
    monster!.y = -60; // 코어 사거리(attackRange+CORE_RADIUS=36) 밖 — 코어 대신 건축물부터 공격해야 함

    const grantAndBuild = world.getPlayers().get('builder')!;
    grantAndBuild.wood = 100;
    grantAndBuild.stone = 100;
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
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher'; // aggroRadius 120
    monster!.x = 10;
    monster!.y = 0;
    monster!.facingX = 1; // target(200,0) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05);
    expect(monster!.targetPlayerId).toBe('target'); // 타겟 획득 확인

    const grantAndBuild = world.getPlayers().get('builder')!;
    grantAndBuild.wood = 100;
    grantAndBuild.stone = 100;
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
});
