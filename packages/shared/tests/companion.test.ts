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

describe('World — 티모시가 코어 자체에 막혀 이동을 못 하는 버그', () => {
  /**
   * moveCompanionToward의 목적지(코어로 돌아갈 땐 원점, 자원 노드로 갈 땐 그 노드)가
   * 코어를 정확히 가로지르는 수평선 위에 있으면, 축 슬라이딩(전체→X만→Y만) 두
   * 단계만으로는 영원히 멈춘다 — 코어 서쪽 벽(수직 평면)을 정면으로 마주 보는
   * 경우 X축 이동은 그대로 벽을 파고들어 막히고, Y축 이동은 방향 성분이 정확히
   * 0이라(dirY===0) 애초에 시도조차 안 된다. 실제로 수정 전 코드로 재현했다 —
   * -70,0에서 70,0의 노드로 가려 하면 -62.67,0(코어 서쪽 경계 바로 앞)에서 멈춰
   * 선 채 그대로 있었다. 접선 미끄러짐 + 탈출 점프(몬스터의 docs/backend/40과
   * 같은 해법)를 추가한 뒤로는 결국 도달해야 한다.
   */
  it('코어를 정면으로 관통하는 경로로 자원 노드를 찾아가도 결국 도착한다', () => {
    const world = createTestWorld();
    const companion = mutableCompanion(world);
    const [node] = [...world.getResourceNodes().values()];
    node!.x = 70;
    node!.y = 0;
    companion.x = -70;
    companion.y = 0;
    companion.state = 'traveling';
    companion.targetNodeId = node!.id;

    let reached = false;
    for (let tick = 0; tick < 1800 && !reached; tick += 1) {
      // 최대 30초(탈출 임계값 1.5초보다 훨씬 넉넉하게) — 실제 서버 틱레이트로.
      world.tick(1 / 60);
      if (world.getCompanion().state !== 'traveling') reached = true; // harvesting 등으로 전환됨
    }

    expect(reached).toBe(true);
  });

  it('코어를 정면으로 관통하는 경로로 코어에 복귀해도 결국 도착한다', () => {
    const world = createTestWorld();
    const companion = mutableCompanion(world);
    companion.x = -70;
    companion.y = 0;
    companion.state = 'returning';
    companion.carriedWood = companionData.capacity;

    let reached = false;
    for (let tick = 0; tick < 1800 && !reached; tick += 1) {
      world.tick(1 / 60);
      if (world.getCompanion().state !== 'returning') reached = true; // depositing 등으로 전환됨
    }

    expect(reached).toBe(true);
  });

  it('코어 주변 어느 각도에서 복귀를 시작해도 결국 코어 상호작용 반경 안에 도달한다', () => {
    const ANGLE_SAMPLES = 16;
    const START_RADIUS = 70; // 코어 발자국(최대 반경 52) 바로 바깥

    for (let i = 0; i < ANGLE_SAMPLES; i += 1) {
      const angle = (i / ANGLE_SAMPLES) * Math.PI * 2;
      const world = createTestWorld();
      const companion = mutableCompanion(world);
      companion.x = Math.cos(angle) * START_RADIUS;
      companion.y = Math.sin(angle) * START_RADIUS;
      companion.state = 'returning';
      companion.carriedWood = companionData.capacity;

      let reached = false;
      for (let tick = 0; tick < 1800 && !reached; tick += 1) {
        world.tick(1 / 60);
        if (world.getCompanion().state !== 'returning') reached = true;
      }

      expect(reached, `각도 ${i}/${ANGLE_SAMPLES}에서 갇힘`).toBe(true);
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

    // 공격이 "시도 → 예고 → 판정" 3단계라 예고(demon 0.36초)를 지나야 맞는다.
    // 그 사이 티모시는 채집하러 걸어가 사거리를 벗어나므로(그게 정상이다) 이
    // 테스트가 보려는 상황 — 사거리 안에 있는 경우 — 을 유지하도록 붙들어 둔다.
    for (let i = 0; i < 60; i += 1) {
      companion.x = monster.x;
      companion.y = monster.y;
      world.tick(0.02);
    }

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

describe('티모시 끄기 — 방 설정', () => {
  function worldWithoutCompanion(): World {
    return new World({ rng: seededRng(1), companion: false });
  }

  it("끈 방의 티모시는 'absent'로 서고 자원을 모으지 않는다", () => {
    const world = worldWithoutCompanion();
    const companion = mutableCompanion(world);
    const storageBefore = world.getCore().storage.countOf('wood');

    expect(companion.state).toBe('absent');
    // 넉넉히 돌려도 상태가 그대로다 — 수확 루프가 아예 안 돈다.
    for (let i = 0; i < 600; i += 1) world.tick(1 / 60);

    expect(companion.state).toBe('absent');
    expect(companion.carriedWood + companion.carriedStone).toBe(0);
    expect(world.getCore().storage.countOf('wood')).toBe(storageBefore);
  });

  it('없는 티모시는 낮이 와도 되살아나지 않는다', () => {
    // 'absent'를 'downed'와 같은 취급으로 두면 첫 아침에 티모시가 생겨난다.
    const world = worldWithoutCompanion();
    const companion = mutableCompanion(world);

    world.runDevCommand('nobody', 'day');

    expect(companion.state).toBe('absent');
  });

  it('없는 티모시에게 말을 걸면 거절한다', () => {
    const world = worldWithoutCompanion();
    world.addPlayer('p1', 0, 0);

    expect(world.sendCompanionMessage('p1', '안녕')).toBe(false);
    // 바로 옆에 서 있어도 상호작용 대상이 아니다.
    expect(world.requestCompanionInteraction('p1')).toBe(false);
  });

  it('몬스터가 없는 티모시를 때리지 않는다', () => {
    // 판정 자리가 여섯 군데라 한 곳만 빠뜨려도 없는 티모시가 표적이 된다.
    // 같은 상황(겹쳐 세우고 60틱)에서 켠 방은 다운되는 것이 위 테스트로 확인돼 있다.
    const world = worldWithoutCompanion();
    world.addPlayer('tester', 400, 400); // 몬스터가 사람 대신 티모시를 노리게 멀리 둔다
    world.runDevCommand('tester', 'spawn demon 1');
    const [monster] = [...world.getMonsters().values()];
    const companion = mutableCompanion(world);

    for (let i = 0; i < 60; i += 1) {
      companion.x = monster.x;
      companion.y = monster.y;
      world.tick(0.02);
    }

    expect(world.getCompanion().hp).toBe(companionData.maxHp);
    expect(world.getCompanion().state).toBe('absent');
  });

  it('기본값은 켬이다 — 옵션을 안 주면 기존과 같이 티모시가 있다', () => {
    expect(mutableCompanion(createTestWorld()).state).not.toBe('absent');
  });
});
