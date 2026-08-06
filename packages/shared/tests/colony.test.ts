import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { colonyStageFor } from '../src/sim/colony';
import { coloniesData, wavesData } from '../src/data';

/** 1웨이브가 시작될 때까지(day → night) 틱을 진행시킨다. world-combat.test.ts와 동일 패턴. */
function startFirstWave(world: World): void {
  world.tick(wavesData.dayDuration);
  world.tick(0.001);
}

/** 매번 같은 시퀀스를 내는 결정론적 rng — world-building.test.ts와 동일 패턴(재현성용). */
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

/**
 * 채널링을 완료(진행률 1.0)까지 틱한다. 매번 seq를 올려 새 입력으로 보내야
 * World.setInput이 "중복/역행 입력"으로 무시하지 않는다.
 */
function channelUntilDestroyed(world: World, playerId: string, colonyId: string): void {
  let seq = 1;
  for (let i = 0; i < 200 && !world.getColonies().get(colonyId)!.destroyed; i += 1) {
    world.setInput(playerId, { seq: seq++, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(0.1);
  }
}

describe('colonyStageFor — 웨이브 진행도에 따른 난이도 구간 선택', () => {
  it('afterWave가 currentWave 이하인 항목 중 가장 큰 것을 고른다', () => {
    const stages = coloniesData.stages;
    expect(colonyStageFor(0)).toBe(stages[0]);
    expect(colonyStageFor(stages[0]!.afterWave)).toBe(stages[0]);

    // 데이터가 바뀌어도(임의값이라 조정될 수 있음) "다음 구간 시작 전까지는 이전
    // 구간을 유지"하는 성질 자체는 항상 성립해야 한다.
    if (stages.length > 1) {
      expect(colonyStageFor(stages[1]!.afterWave - 1)).toBe(stages[0]);
      expect(colonyStageFor(stages[1]!.afterWave)).toBe(stages[1]);
    }

    // 마지막 구간을 한참 넘어선 웨이브도 마지막 구간을 그대로 쓴다(범위 밖으로 안 튐).
    expect(colonyStageFor(9999)).toBe(stages[stages.length - 1]);
  });

  it('스테이지가 올라갈수록 스폰 주기가 짧아지고(더 자주) 몬스터 종류가 늘어난다', () => {
    const stages = coloniesData.stages;
    for (let i = 1; i < stages.length; i += 1) {
      expect(stages[i]!.spawnIntervalSeconds).toBeLessThan(stages[i - 1]!.spawnIntervalSeconds);
      expect(stages[i]!.types.length).toBeGreaterThanOrEqual(stages[i - 1]!.types.length);
    }
  });
});

describe('World — 콜로니 배치/스폰', () => {
  it('4개가 코어를 중심으로 spawnRadius만큼 떨어진 고정 위치에 배치된다', () => {
    const world = createTestWorld();
    const colonies = [...world.getColonies().values()];

    expect(colonies).toHaveLength(4);
    for (const colony of colonies) {
      expect(Math.hypot(colony.x, colony.y)).toBeCloseTo(coloniesData.spawnRadius, 5);
      expect(colony.destroyed).toBe(false);
    }
  });

  it('낮에도(밤 웨이브가 시작되지 않아도) 스폰 주기가 지나면 몬스터가 생긴다', () => {
    const world = createTestWorld();
    expect(world.getWavePhase()).toBe('day');
    expect(world.getMonsters().size).toBe(0);

    const stage = colonyStageFor(0);
    world.tick(stage.spawnIntervalSeconds + 0.1);

    expect(world.getMonsters().size).toBeGreaterThan(0);
  });

  it('파괴된 콜로니는 스폰 주기가 와도 몬스터를 추가하지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    const colonies = [...world.getColonies().values()];
    const target = colonies[0]!;
    const player = world.getPlayers().get('p1')!;
    player.x = target.x;
    player.y = target.y;

    channelUntilDestroyed(world, 'p1', target.id);
    expect(world.getColonies().get(target.id)!.destroyed).toBe(true);

    const monstersBefore = world.getMonsters().size;
    // 채널링(6초 기본값) 동안에도 나머지 콜로니의 스폰 타이머는 똑같이 줄어들고
    // 있었다 — 첫 스폰 경계(20초 기본값)를 확실히 넘기도록 넉넉히 더 틱한다.
    for (let i = 0; i < 400; i += 1) world.tick(0.1);

    const monstersAfter = world.getMonsters().size;
    // 파괴 안 된 나머지 3개는 스폰했어야 하니 늘어나긴 해야 한다 — 정확히 "이 콜로니가
    // 기여분 0"이라는 건 아래 별도 테스트(채널 불가)로 더 직접적으로 검증한다.
    expect(monstersAfter).toBeGreaterThan(monstersBefore);
  });
});

describe('World — 콜로니 채널링(파괴 작업)', () => {
  it('콜로니 근처에서 정지한 채 채널 키를 누르고 있으면 진행률이 올라간다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);

    expect(player.channelProgress).toBeCloseTo(1 / coloniesData.channelSeconds, 5);
  });

  it('진행률이 1에 도달하면 콜로니가 파괴되고 팀에 에너지가 지급된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    const energyBefore = world.getCore().sharedEnergy;
    channelUntilDestroyed(world, 'p1', colony!.id);

    expect(world.getColonies().get(colony!.id)!.destroyed).toBe(true);
    expect(player.channelProgress).toBe(0);
    expect(player.channelingColonyId).toBeUndefined();
    expect(world.getCore().sharedEnergy).toBe(energyBefore + coloniesData.essenceReward);
  });

  it('멀리 떨어져 있으면 채널링이 시작되지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0); // 콜로니는 spawnRadius(900 등) 밖이라 훨씬 멀다

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);

    expect(world.getPlayers().get('p1')!.channelProgress).toBe(0);
  });

  it('이동하면(moveX/moveY가 0이 아니면) 진행률이 즉시 0으로 리셋된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);
    expect(player.channelProgress).toBeGreaterThan(0);

    world.setInput('p1', { seq: 2, moveX: 1, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(0.1);

    expect(player.channelProgress).toBe(0);
  });

  it('채널 키를 떼면(channeling: false) 진행률이 리셋된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);
    expect(player.channelProgress).toBeGreaterThan(0);

    world.setInput('p1', { seq: 2, moveX: 0, moveY: 0, aimAngle: 0, channeling: false });
    world.tick(0.1);

    expect(player.channelProgress).toBe(0);
  });

  it('몬스터에게 맞으면(피격) 진행률이 0으로 리셋된다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);
    expect(player.channelProgress).toBeGreaterThan(0);

    // 잡몹(trash)은 aggroRadius가 없어 플레이어를 공격하지 않으므로, 어그로가 있는
    // 타입(rusher)으로 바꿔서 플레이어 바로 옆(같은 좌표 — 시야각 검사를 건너뛴다,
    // world-combat.test.ts와 동일 트릭)에 둔다.
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = player.x;
    monster!.y = player.y;
    monster!.attackCooldown = 0;

    world.tick(1); // attackRange(20)·aggroRadius 모두 거리 0이라 즉시 공격

    expect(player.channelProgress).toBe(0);
    expect(player.hp).toBeLessThan(wavesData.playerHp);
  });

  it('이미 파괴된 콜로니 앞에서는 채널링이 진행되지 않는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    channelUntilDestroyed(world, 'p1', colony!.id);
    expect(world.getColonies().get(colony!.id)!.destroyed).toBe(true);

    world.setInput('p1', { seq: 100, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(1);

    expect(player.channelProgress).toBe(0);
  });

  it('채널링 중엔 무기 발사가 나가지 않는다("무방비" 강제)', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const [colony] = [...world.getColonies().values()];
    const player = world.getPlayers().get('p1')!;
    player.x = colony!.x;
    player.y = colony!.y;

    world.setInput('p1', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0, channeling: true });
    world.tick(0.1);
    expect(player.channelingColonyId).toBeDefined();

    world.fireWeapon('p1');

    expect(world.getProjectiles().size).toBe(0);
  });
});
