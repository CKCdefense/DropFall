import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { colonyStageData, maxColonyStage } from '../src/sim/colony';
import { coloniesData, wavesData } from '../src/data';

/** 매번 같은 시퀀스를 내는 결정론적 rng — world-building.test.ts와 동일 패턴(재현성용). */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * 콜로니는 startColonies()를 명시적으로 불러야 생긴다(docs/backend/41, 인원수가
 * 확정돼야 만들 수 있어서 World 생성자에서 뺐다).
 */
function createTestWorld(colonyCount = 4, seed = 1): World {
  const world = new World({ rng: seededRng(seed) });
  world.startColonies(colonyCount);
  return world;
}

/** 첫 번째 콜로니와 그 트리거 반경 안에 세운 플레이어를 준비한다. */
function worldWithPlayerAtColony(): {
  world: World;
  colonyId: string;
} {
  const world = createTestWorld();
  const [colony] = [...world.getColonies().values()];
  // 트리거 반경 안, 콜로니 충돌 반경 밖(끼임 방지).
  world.addPlayer('p1', colony!.x + 60, colony!.y);
  return { world, colonyId: colony!.id };
}

/** 표준 수학적 사분면(I~IV) 인덱스(0~3). colony.ts의 사분면 정의와 같다. */
function quadrantOf(x: number, y: number): number {
  const angle = Math.atan2(y, x);
  const normalized = angle < 0 ? angle + Math.PI * 2 : angle;
  return Math.floor(normalized / (Math.PI / 2)) % 4;
}

describe('colonyStageData — 성장 단계 데이터', () => {
  it('단계가 올라갈수록 저장량과 정화 보상이 커지고, 몬스터 종류가 늘어난다', () => {
    const stages = coloniesData.stages;
    for (let i = 1; i < stages.length; i += 1) {
      expect(stages[i]!.stored).toBeGreaterThan(stages[i - 1]!.stored);
      expect(stages[i]!.purifyEnergy).toBeGreaterThan(stages[i - 1]!.purifyEnergy);
      expect(stages[i]!.types.length).toBeGreaterThanOrEqual(stages[i - 1]!.types.length);
    }
  });

  it('범위를 벗어난 단계 번호는 가장 가까운 끝 단계로 조인다', () => {
    expect(colonyStageData(0)).toBe(coloniesData.stages[0]);
    expect(colonyStageData(999)).toBe(coloniesData.stages[coloniesData.stages.length - 1]);
  });
});

describe('World — 콜로니 배치', () => {
  it('4개가 코어 중심 spawnRadiusMin~Max 사이, 서로 다른 사분면에 1단계로 배치된다', () => {
    const world = createTestWorld();
    const colonies = [...world.getColonies().values()];

    expect(colonies).toHaveLength(4);
    const seenQuadrants = new Set<number>();
    for (const colony of colonies) {
      const distance = Math.hypot(colony.x, colony.y);
      expect(distance).toBeGreaterThanOrEqual(coloniesData.spawnRadiusMin);
      expect(distance).toBeLessThanOrEqual(coloniesData.spawnRadiusMax);
      expect(colony.stage).toBe(1);
      expect(colony.stored).toBe(colonyStageData(1).stored);
      expect(colony.purified).toBe(false);

      const quadrant = quadrantOf(colony.x, colony.y);
      expect(seenQuadrants.has(quadrant)).toBe(false); // 사분면당 1개만
      seenQuadrants.add(quadrant);
    }
    expect(seenQuadrants.size).toBe(4);
  });

  it('인원수만큼만 콜로니가 생긴다(1~4명), 4를 넘으면 clamp', () => {
    for (let n = 1; n <= 4; n += 1) {
      expect(createTestWorld(n).getColonies().size).toBe(n);
    }
    expect(createTestWorld(7).getColonies().size).toBe(4);
  });

  it('어떤 두 콜로니 쌍도 minSpacing보다 가깝지 않다(여러 시드로 반복)', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const colonies = [...createTestWorld(4, seed).getColonies().values()];
      for (let i = 0; i < colonies.length; i += 1) {
        for (let j = i + 1; j < colonies.length; j += 1) {
          const distance = Math.hypot(
            colonies[i]!.x - colonies[j]!.x,
            colonies[i]!.y - colonies[j]!.y,
          );
          expect(distance).toBeGreaterThanOrEqual(coloniesData.minSpacing);
        }
      }
    }
  });

  it('시드가 다르면 콜로니 위치도 달라진다(고정 위치가 아니다)', () => {
    const positions = (seed: number) =>
      [...createTestWorld(4, seed).getColonies().values()].map(
        (c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`,
      );
    expect(positions(1)).not.toEqual(positions(2));
  });
});

describe('World — 수호대 소환/귀환', () => {
  it('아무도 접근하지 않으면 수호대가 나오지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0); // 콜로니는 최소 700px 밖이라 트리거 반경 밖이다
    world.tick(coloniesData.guardRespawnSeconds * 4);
    expect(world.getMonsters().size).toBe(0);
  });

  it('트리거 반경 안에 들어가면 저장분에서 수호대가 소환되고 stored가 준다', () => {
    const { world, colonyId } = worldWithPlayerAtColony();
    const storedBefore = world.getColonies().get(colonyId)!.stored;

    world.tick(coloniesData.guardRespawnSeconds + 0.1);

    const colony = world.getColonies().get(colonyId)!;
    expect(world.getMonsters().size).toBeGreaterThan(0);
    expect(colony.stored).toBe(storedBefore - world.getMonsters().size);
    for (const monster of world.getMonsters().values()) {
      expect(monster.homeColonyId).toBe(colonyId);
      // 수호대 타입은 그 단계의 로스터에서 나온다.
      expect(colonyStageData(colony.stage).types).toContain(monster.type);
    }
  });

  it('동시 수호대 수는 guardConcurrent를 넘지 않는다', () => {
    const { world } = worldWithPlayerAtColony();
    // 보충 간격을 여러 번 넘겨도 상한 유지. 수호대가 죽지 않도록 플레이어는 그대로 둔다.
    for (let i = 0; i < 40; i += 1) world.tick(coloniesData.guardRespawnSeconds / 2);
    expect(world.getMonsters().size).toBeLessThanOrEqual(coloniesData.guardConcurrent);
  });

  it('플레이어가 리시 반경 밖으로 떠나면 수호대가 콜로니로 돌아가 저장 상태로 복귀한다(stored 복원)', () => {
    const { world, colonyId } = worldWithPlayerAtColony();
    world.tick(coloniesData.guardRespawnSeconds + 0.1);
    expect(world.getMonsters().size).toBeGreaterThan(0);

    const colony = world.getColonies().get(colonyId)!;
    const storedAfterSpawn = colony.stored;

    // 멀리 도망친다 — 리시 밖.
    const player = world.getPlayers().get('p1')!;
    player.x = 0;
    player.y = 0;

    // 귀환 이동 + 도착 대기(returnDespawnSeconds)까지 넉넉히 굴린다.
    for (let i = 0; i < 600 && world.getMonsters().size > 0; i += 1) world.tick(0.1);

    expect(world.getMonsters().size).toBe(0);
    expect(colony.stored).toBeGreaterThan(storedAfterSpawn);
    expect(colony.stored).toBe(colonyStageData(colony.stage).stored); // 전원 복귀 = 원상 복구
    expect(colony.purified).toBe(false); // 아무도 안 죽었으니 정화가 아니다
  });

  it('수호대가 죽으면 stored는 복원되지 않는다(영구 감소)', () => {
    const { world, colonyId } = worldWithPlayerAtColony();
    world.tick(coloniesData.guardRespawnSeconds + 0.1);

    const colony = world.getColonies().get(colonyId)!;
    const storedAfterSpawn = colony.stored;
    const guards = [...world.getMonsters().values()];
    expect(guards.length).toBeGreaterThan(0);

    // 수호대를 전부 직접 처치한다(전투 메커니즘은 다른 테스트가 검증).
    for (const guard of guards) {
      (world as unknown as { damageMonster(id: string, hp: number): void }).damageMonster(
        guard.id,
        0,
      );
    }

    expect(colony.stored).toBe(storedAfterSpawn);
    expect(colony.guardIds.size).toBe(0);
  });
});

describe('World — 정화/성장/재보급', () => {
  /** 접근-소환-처치를 반복해서 콜로니를 비운다. */
  function purifyByCombat(world: World, colonyId: string): void {
    const kill = (world as unknown as { damageMonster(id: string, hp: number): void }).damageMonster.bind(
      world,
    );
    for (let i = 0; i < 500; i += 1) {
      const colony = world.getColonies().get(colonyId)!;
      if (colony.purified) return;
      world.tick(coloniesData.guardRespawnSeconds / 2);
      for (const monster of [...world.getMonsters().values()]) kill(monster.id, 0);
      world.tick(0.05); // 정화 판정 틱
    }
    throw new Error('정화에 도달하지 못했다');
  }

  it('저장분과 수호대를 전부 처치하면 정화된다 — 에너지 보상 + 1단계 초기화 + 빈 껍데기', () => {
    const { world, colonyId } = worldWithPlayerAtColony();
    const energyBefore = world.getCore().energy;

    purifyByCombat(world, colonyId);

    const colony = world.getColonies().get(colonyId)!;
    expect(colony.purified).toBe(true);
    expect(colony.stage).toBe(1);
    expect(colony.stored).toBe(0);
    expect(world.getCore().energy).toBe(energyBefore + colonyStageData(1).purifyEnergy);

    // 빈 껍데기에서는 계속 서 있어도 수호대가 더 나오지 않는다.
    world.tick(coloniesData.guardRespawnSeconds * 3);
    expect(world.getMonsters().size).toBe(0);
  });

  it('정화 안 된 콜로니는 새 낮마다 한 단계 성장하고(최대 3), 정화된 콜로니는 1단계로 재보급된다', () => {
    const { world, colonyId } = worldWithPlayerAtColony();
    purifyByCombat(world, colonyId);

    // 다른 콜로니 하나를 비교 대상으로 잡는다(아무도 접근 안 함 = 정화 안 됨).
    const other = [...world.getColonies().values()].find((c) => c.id !== colonyId)!;
    expect(other.stage).toBe(1);

    // 낮 전환을 dev 커맨드 대신 정상 경로(onDayBegan)와 같은 함수로 흉내낸다 —
    // private 접근이지만 이 파일은 이미 damageMonster로 같은 패턴을 쓴다.
    (world as unknown as { onDayBegan(): void }).onDayBegan();

    const purified = world.getColonies().get(colonyId)!;
    expect(purified.purified).toBe(false); // 재보급 완료
    expect(purified.stage).toBe(1);
    expect(purified.stored).toBe(colonyStageData(1).stored);

    expect(other.stage).toBe(2); // 성장
    expect(other.stored).toBe(colonyStageData(2).stored);

    // 성장은 최대 단계에서 멈춘다.
    for (let i = 0; i < 10; i += 1) (world as unknown as { onDayBegan(): void }).onDayBegan();
    expect(other.stage).toBe(maxColonyStage());
    expect(other.stored).toBe(colonyStageData(maxColonyStage()).stored);
  });
});

describe('World — 밤 침공 복제', () => {
  it('밤이 시작되면 콜로니 저장분의 waveContributionRatio만큼 복제되어 콜로니 쪽에서 스폰되고, 저장분은 줄지 않는다', () => {
    const world = createTestWorld(1); // 콜로니 1개 — 기여분 추적이 단순해진다
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const storedBefore = colony!.stored;
    const expectedClones = Math.floor(storedBefore * coloniesData.waveContributionRatio);

    // day → night 전환 틱. 이 틱 안에서 복제분 첫 무리가 콜로니 곁에 스폰된다 —
    // 웨이브 본대는 다음 틱부터 나오므로, 전환 직후의 몬스터는 전부 복제분이다.
    // (전환 후 더 틱하면 복제분이 코어를 향해 걸어가 콜로니에서 멀어지므로,
    // "콜로니 방향에서 나왔다"는 전환 직후에만 깨끗하게 잴 수 있다.)
    world.tick(wavesData.dayDuration);

    const clones = [...world.getMonsters().values()];
    expect(clones.length).toBe(expectedClones);
    for (const clone of clones) {
      expect(Math.hypot(clone.x - colony!.x, clone.y - colony!.y)).toBeLessThan(120);
      expect(clone.homeColonyId).toBeUndefined(); // 복제분은 수호대가 아니라 침공 부대다
    }
    expect(colony!.stored).toBe(storedBefore); // 복제 — 저장분은 그대로
  });

  it('정화된 콜로니는 침공에 합류하지 않는다', () => {
    const world = createTestWorld(1);
    const [colony] = [...world.getColonies().values()];
    // 정화 상태를 직접 만든다(전투 경유는 위 테스트가 검증).
    colony!.stored = 0;
    colony!.purified = true;

    world.addPlayer('p1', 0, 0);

    // 위 테스트와 같은 이유로 **전환 틱만** 본다 — 이 틱에는 침공 복제분만 나온다.
    // 그 뒤로도 계속 보면 웨이브 본대(스폰 반경 900)가 콜로니(700~1000) 근처에
    // 떨어지는 판이 섞여서, 복제분과 구분할 방법이 없어진다.
    world.tick(wavesData.dayDuration); // day → night

    expect(world.getMonsters().size).toBe(0); // 정화된 콜로니는 한 마리도 안 보낸다
  });
});
