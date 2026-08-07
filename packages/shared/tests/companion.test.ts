import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { companionData, resourcesData } from '../src/data';
import { HIT_RADIUS } from '../src/sim/combat';
import type { CompanionEntity } from '../src/sim/companion';

/** 매번 같은 시퀀스를 내는 결정론적 rng — colony.test.ts/wave.test.ts와 동일 패턴. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function createTestWorld(): World {
  return new World({ rng: seededRng(1) });
}

/** 테스트에서만 쓰는 mutable 캐스트 — colony.test.ts의 spawnTimer 직접 조작과 동일 패턴. */
function mutableCompanion(world: World): CompanionEntity {
  return world.getCompanion() as CompanionEntity;
}

/** companion 위치에서 실제로 가장 가까운 노드 — seeking 로직과 같은 기준으로 검증하기 위함. */
function nearestNodeTo(world: World, x: number, y: number) {
  let nearest: { id: string } | undefined;
  let nearestDistance = Infinity;
  for (const node of world.getResourceNodes().values()) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (distance < nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }
  return nearest;
}

describe('companionData — 데이터 불변식', () => {
  it('harvestRange는 자원 노드의 이동 충돌 반경보다 커야 한다(실제로 겪은 버그: 같거나 작으면 이동 판정에 막혀 영원히 도착 못 하고 traveling만 반복한다)', () => {
    for (const type of Object.keys(resourcesData) as (keyof typeof resourcesData)[]) {
      const blockRadius = HIT_RADIUS + resourcesData[type].hitRadius;
      expect(companionData.harvestRange).toBeGreaterThan(blockRadius);
    }
  });
});

describe('World — 티모시(AI 동반자) 생성/탐색', () => {
  it('처음엔 seeking 상태이고, 틱하면 가장 가까운 노드를 찾아 traveling으로 전환한다', () => {
    const world = createTestWorld();
    const spawn = world.getCompanion();
    const nearest = nearestNodeTo(world, spawn.x, spawn.y);

    world.tick(0.1);

    expect(world.getCompanion().state).toBe('traveling');
    expect(world.getCompanion().targetNodeId).toBe(nearest?.id);
  });
});

describe('World — 티모시 채집', () => {
  it('harvestRange 안이면 채집을 시작하고, 노드가 고갈되면 자원을 획득한다(바닥 드랍 없음)', () => {
    const world = createTestWorld();
    const [node] = [...world.getResourceNodes().values()];
    const companion = mutableCompanion(world);
    companion.x = node.x;
    companion.y = node.y;
    companion.state = 'traveling';
    companion.targetNodeId = node.id;

    world.tick(0.1); // traveling → harvesting(사거리 안이라 바로 전환)
    expect(world.getCompanion().state).toBe('harvesting');

    const data = resourcesData[node.type];
    const hitsNeeded = Math.ceil(data.hp / companionData.harvestDamage);
    for (let i = 0; i < hitsNeeded; i += 1) {
      world.tick(companionData.harvestIntervalSeconds + 0.01);
    }

    expect(node.hp).toBe(0);
    expect(world.getDroppedItems().size).toBe(0); // 설계 의도: 바닥 드랍 생성 안 함
    const carried = world.getCompanion().carriedWood + world.getCompanion().carriedStone;
    expect(carried).toBe(data.yieldOnDeplete);
  });

  it('용량(capacity)을 채우면 다음 채집 후 returning으로 전환한다', () => {
    const world = createTestWorld();
    const [node] = [...world.getResourceNodes().values()];
    const data = resourcesData[node.type];
    const companion = mutableCompanion(world);
    companion.x = node.x;
    companion.y = node.y;
    companion.state = 'traveling';
    companion.targetNodeId = node.id;
    // 이번 한 번의 수확으로 용량을 넘기게 미리 채워둔다.
    companion.carriedWood = Math.max(0, companionData.capacity - data.yieldOnDeplete + 1);

    world.tick(0.1); // traveling → harvesting
    const hitsNeeded = Math.ceil(data.hp / companionData.harvestDamage);
    for (let i = 0; i < hitsNeeded; i += 1) {
      world.tick(companionData.harvestIntervalSeconds + 0.01);
    }

    expect(world.getCompanion().state).toBe('returning');
  });

  it('코어 상호작용 범위에서 returning이면 depositing으로, 그다음 틱에 적립하고 seeking으로 리셋된다', () => {
    const world = createTestWorld();
    const companion = mutableCompanion(world);
    companion.state = 'returning';
    companion.carriedWood = 12;
    companion.carriedStone = 3;
    companion.x = 0;
    companion.y = 0;

    world.tick(0.1);
    expect(world.getCompanion().state).toBe('depositing');

    world.tick(0.1);
    expect(world.getCompanion().state).toBe('seeking');
    expect(world.getCompanion().carriedWood).toBe(0);
    expect(world.getCompanion().carriedStone).toBe(0);
    expect(world.getCore().storage.countOf('wood')).toBe(12);
    expect(world.getCore().storage.countOf('stone')).toBe(3);
  });
});

describe('World — 티모시 피격/다운/리셋', () => {
  it('몬스터 공격 사거리 안에 있으면 맞고, hp가 0이 되면 다운된다', () => {
    const world = createTestWorld();
    world.addPlayer('tester', 0, 0); // runDevCommand는 hasPlayer를 요구한다
    world.runDevCommand('tester', 'spawn demon 1');
    const [monster] = [...world.getMonsters().values()];
    const companion = mutableCompanion(world);
    companion.x = monster.x;
    companion.y = monster.y;
    companion.hp = 1;

    world.tick(0.1);

    expect(world.getCompanion().state).toBe('downed');
    expect(world.getCompanion().hp).toBe(0);
  });

  it('다운 중엔 이동/채집을 하지 않는다', () => {
    const world = createTestWorld();
    const companion = mutableCompanion(world);
    companion.state = 'downed';
    companion.hp = 0;
    const before = { x: companion.x, y: companion.y };

    world.tick(1);

    expect(world.getCompanion().x).toBe(before.x);
    expect(world.getCompanion().y).toBe(before.y);
    expect(world.getCompanion().state).toBe('downed');
  });

  it('낮이 시작되면(정상 진행/day 커맨드와 동일한 onDayBegan) 다운된 티모시가 리셋된다', () => {
    const world = createTestWorld();
    world.addPlayer('tester', 0, 0); // runDevCommand는 hasPlayer를 요구한다
    const companion = mutableCompanion(world);
    companion.state = 'downed';
    companion.hp = 0;

    world.runDevCommand('tester', 'wave 1');
    world.runDevCommand('tester', 'day');

    expect(world.getCompanion().state).toBe('seeking');
    expect(world.getCompanion().hp).toBe(companionData.maxHp);
  });
});
