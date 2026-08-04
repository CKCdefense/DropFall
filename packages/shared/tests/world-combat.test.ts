import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { wavesData } from '../src/data';

/** 1웨이브가 시작될 때까지(day → night) 틱을 진행시킨다. */
function startFirstWave(world: World): void {
  world.tick(wavesData.dayDuration);
  world.tick(0.001); // night 진입 직후 첫 스폰 트리거
}

/** 몬스터가 최소 count마리 스폰될 때까지 잘게 쪼개 틱한다(스폰 간격을 넘기기 위해). */
function spawnAtLeast(world: World, count: number): void {
  for (let i = 0; i < 5000 && world.getMonsters().size < count; i += 1) {
    world.tick(0.1);
  }
}

describe('World — 전투/웨이브 통합', () => {
  it('day로 시작해서 dayDuration이 지나면 night(1웨이브)로 전환된다', () => {
    const world = new World();
    expect(world.getWavePhase()).toBe('day');

    startFirstWave(world);

    expect(world.getWavePhase()).toBe('night');
    expect(world.getCurrentWave()).toBe(1);
    expect(world.getMonsters().size).toBeGreaterThan(0);
  });

  it('근접 무기로 근처 몬스터를 때리면 데미지가 들어가고, 여러 번 맞으면 죽는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    // 스폰된 몬스터 중 하나를 플레이어 바로 옆으로 옮겨서 근접 사거리 안에 둔다
    const [monster] = [...world.getMonsters().values()];
    expect(monster).toBeDefined();
    monster!.x = 5;
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1', 'club');

    expect(monster!.hp).toBe(initialHp - 15); // club damage = 15
  });

  it('사거리 밖 몬스터는 근접 공격이 닿지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 10000;
    monster!.y = 10000;
    const initialHp = monster!.hp;

    world.fireWeapon('p1', 'club');

    expect(monster!.hp).toBe(initialHp);
  });

  it('권총(원거리)은 투사체를 만들고, 투사체가 이동해 몬스터에 맞으면 데미지를 준다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 100;
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1', 'pistol'); // aimAngle 기본 0 → +x 방향으로 발사
    expect(world.getProjectiles().size).toBe(1);

    // 실제 서버는 60Hz(≈0.0167s) 단위로 tick()을 호출한다 — 한 번에 큰 dt로 틱하면
    // 투사체가 몬스터를 한 프레임 만에 통과해버려(터널링) 충돌을 놓칠 수 있다.
    for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) {
      world.tick(1 / 60);
    }

    expect(world.getProjectiles().size).toBe(0); // 명중 후 소멸
    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('쿨다운이 끝나기 전에 다시 발사하면 무시된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 5;
    monster!.y = 0;

    world.fireWeapon('p1', 'club');
    const hpAfterFirst = monster!.hp;
    world.fireWeapon('p1', 'club'); // fireRate 2 → 0.5초 간격, 아직 안 지남

    expect(monster!.hp).toBe(hpAfterFirst);
  });

  it('존재하지 않는 무기 id는 조용히 무시된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);

    expect(() => world.fireWeapon('p1', 'not-a-weapon')).not.toThrow();
    expect(world.getProjectiles().size).toBe(0);
  });

  it('weaponId가 문자열이 아니면 무시된다(클라이언트 입력 불신)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);

    expect(() => world.fireWeapon('p1', 123)).not.toThrow();
    expect(() => world.fireWeapon('p1', null)).not.toThrow();
    expect(world.getProjectiles().size).toBe(0);
  });

  it('몬스터가 코어 사거리 안에 있으면 코어 HP가 깎인다', () => {
    const world = new World();
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 0;
    monster!.y = 0; // 코어 바로 위 — attackRange + CORE_RADIUS 안

    const initialHp = world.getCore().hp;
    world.tick(1.5); // attackInterval(1초 또는 그 이상)이 지나도록

    expect(world.getCore().hp).toBeLessThan(initialHp);
  });

  it('코어 HP가 0이 되면 패배 상태가 된다', () => {
    const world = new World();
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 0;
    monster!.y = 0;

    // 코어 HP를 0 근처로 만들어 다음 공격 한 방으로 패배하게 한다
    (world.getCore() as { hp: number }).hp = 1;
    world.tick(1.5);

    expect(world.getWavePhase()).toBe('defeat');
  });
});

describe('World — 전원 다운 = 즉시 패배', () => {
  it('플레이어 전원의 hp가 0이면 즉시 패배 상태가 된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 10, 10);

    world.getPlayers().get('p1')!.hp = 0;
    world.getPlayers().get('p2')!.hp = 0;
    world.tick(0.1);

    expect(world.getWavePhase()).toBe('defeat');
  });

  it('일부만 다운됐으면 패배가 아니다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 10, 10);

    world.getPlayers().get('p1')!.hp = 0;
    world.tick(0.1);

    expect(world.getWavePhase()).not.toBe('defeat');
  });

  it('플레이어가 아무도 없으면 패배 조건이 아니다', () => {
    const world = new World();
    expect(() => world.tick(0.1)).not.toThrow();
    expect(world.getWavePhase()).not.toBe('defeat');
  });

  it('다운된(hp 0) 플레이어는 돌진형의 추격 대상이 되지 않고, 몬스터는 대신 코어를 노린다', () => {
    const world = new World();
    world.addPlayer('down', 0, 0);
    world.addPlayer('alive', 500, 500); // 어그로 반경(120) 밖 — 추격 후보에서 자연히 제외됨
    world.getPlayers().get('down')!.hp = 0;

    // rusher(돌진형)를 다운된 플레이어=코어 바로 옆에 둔다(둘 다 원점 근처).
    // wave 1엔 rusher가 없으므로 스폰된 몬스터의 타입을 바꿔서 검증한다.
    startFirstWave(world);
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = 1;
    monster!.y = 0;

    const coreHpBefore = world.getCore().hp;
    world.tick(2); // attackInterval을 넘기도록

    // 다운된 플레이어를 어그로 대상으로 잡았다면 코어는 공격받지 않았을 것이다(continue로 스킵).
    // 코어 HP가 깎였다는 건 몬스터가 다운된 플레이어를 무시하고 코어 쪽 로직을 탔다는 뜻이다.
    expect(world.getCore().hp).toBeLessThan(coreHpBefore);
  });

  it('웨이브를 클리어하고 새 낮이 시작되면 다운된 플레이어가 부활한다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 0, 0); // p2가 살아있어야 "전원 다운"이 안 돼서 패배로 안 끝난다
    startFirstWave(world);
    world.getPlayers().get('p1')!.hp = 0;

    // 스폰 큐가 완전히 빌 때까지, 스폰되는 족족 바로 제거해서 "즉시 전멸"을 흉내낸다
    // (킬 메커니즘 자체는 위 근접/원거리 테스트에서 이미 검증했다).
    const monsters = world.getMonsters() as unknown as Map<string, unknown>;
    const wave1 = wavesData.waves[0]!;
    for (let i = 0; i < 5000 && world.getWavePhase() === 'night'; i += 1) {
      world.tick(wave1.nightDuration / 1000);
      for (const id of [...monsters.keys()]) monsters.delete(id);
    }

    expect(world.getWavePhase()).toBe('day');
    expect(world.getPlayers().get('p1')!.hp).toBe(wavesData.playerHp);
  });
});

describe('World — 낮 스킵 투표', () => {
  it('전원이 투표하면 즉시 night으로 전환된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 0, 0);

    world.castSkipVote('p1');
    expect(world.getWavePhase()).toBe('day'); // 아직 한 명 남음

    world.castSkipVote('p2');
    expect(world.getWavePhase()).toBe('night');
  });

  it('night 페이즈에서는 투표해도 효과가 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);

    world.castSkipVote('p1');
    expect(world.getWavePhase()).toBe('night'); // 그대로 유지, 다음 웨이브로 안 넘어감
  });

  it('존재하지 않는 플레이어의 투표는 무시된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);

    expect(() => world.castSkipVote('ghost')).not.toThrow();
    expect(world.getWavePhase()).toBe('day');
  });

  it('투표한 플레이어가 퇴장하면 그 표는 사라진다(새로 들어온 인원 기준으로 다시 만장일치 필요)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 0, 0);

    world.castSkipVote('p1');
    world.removePlayer('p1');
    world.addPlayer('p3', 0, 0);

    // p1의 표가 남아있었다면 p2와 함께 2표로 만장일치(전체 2명)가 되어버렸을 것이다
    world.castSkipVote('p2');
    expect(world.getWavePhase()).toBe('day');
  });
});

describe('World — 몬스터 군집 분리', () => {
  it('가까이 겹친 몬스터끼리는 서로 밀어내서 간격이 벌어진다', () => {
    const world = new World();
    startFirstWave(world);
    spawnAtLeast(world, 2);

    // 스폰된 몬스터 중 둘을 분리 반경(HIT_RADIUS*2.5=25px) 안으로 바짝 붙여놓는다.
    const monsters = [...world.getMonsters().values()];
    monsters[0]!.x = 200;
    monsters[0]!.y = 0;
    monsters[1]!.x = 210;
    monsters[1]!.y = 0;
    const initialGap = Math.abs(monsters[1]!.x - monsters[0]!.x);

    world.tick(0.05);

    const gapAfter = Math.abs(monsters[1]!.x - monsters[0]!.x);
    expect(gapAfter).toBeGreaterThan(initialGap);
  });

  it('멀리 떨어진 몬스터끼리는 서로 영향을 주지 않는다', () => {
    const world = new World();
    startFirstWave(world);
    spawnAtLeast(world, 2);

    const monsters = [...world.getMonsters().values()];
    monsters[0]!.x = 200;
    monsters[0]!.y = 0;
    monsters[1]!.x = -200;
    monsters[1]!.y = 0;

    // 분리력이 없다면 둘 다 그냥 flow field를 따라 코어(원점) 쪽으로만 이동해야 한다.
    world.tick(0.05);

    expect(monsters[0]!.x).toBeLessThan(200);
    expect(monsters[1]!.x).toBeGreaterThan(-200);
  });
});

describe('World — 어그로 타겟 히스테리시스', () => {
  it('한 번 잡은 타겟은 아그로 반경을 살짝 벗어나도(leash 안이면) 유지한다', () => {
    const world = new World();
    world.addPlayer('near', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher'; // aggroRadius 120
    monster!.x = 10;
    monster!.y = 0;
    monster!.facingX = -1; // 플레이어('near', 원점) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05); // 타겟 획득
    expect(monster!.targetPlayerId).toBe('near');

    // 아그로 반경(120) 밖이지만 leash(120*1.5=180) 안으로 플레이어를 이동시킨다.
    world.getPlayers().get('near')!.x = 150;
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBe('near');
  });

  it('leash 반경 밖으로 나가면 타겟을 놓치고 코어 쪽으로 돌아선다', () => {
    const world = new World();
    world.addPlayer('near', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = 10;
    monster!.y = 0;
    monster!.facingX = -1; // 플레이어('near', 원점) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05);
    expect(monster!.targetPlayerId).toBe('near');

    // leash(180)보다 멀리 이동 — 더 이상 근처에 다른 플레이어도 없으므로 타겟이 사라져야 한다.
    world.getPlayers().get('near')!.x = 1000;
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBeUndefined();
  });

  it('타겟이 다운되면(hp 0) 다른 대상으로 넘어간다', () => {
    const world = new World();
    world.addPlayer('down', 0, 0);
    world.addPlayer('alive', 20, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = 0;
    monster!.y = 0;
    // 'down'은 몬스터와 완전히 같은 좌표라 시야각 검사가 자동으로 건너뛰어지지만,
    // 'alive'(x=20)를 나중에 잡으려면 그쪽을 바라보고 있어야 한다.
    monster!.facingX = 1;
    monster!.facingY = 0;

    world.tick(0.05);
    expect(monster!.targetPlayerId).toBe('down'); // 더 가까운 쪽을 먼저 잡음

    world.getPlayers().get('down')!.hp = 0;
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBe('alive');
  });
});

describe('World — 어그로 시야각(120도)', () => {
  it('시야각(전방 ±60도) 밖에 있으면 반경 안이어도 어그로가 잡히지 않는다', () => {
    const world = new World();
    world.addPlayer('behind', -50, 0); // 몬스터 기준 정반대(등 뒤) 방향
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher'; // aggroRadius 120
    monster!.x = 0;
    monster!.y = 0;
    monster!.facingX = 1; // +x 방향을 바라봄 — 플레이어는 -x(등 뒤)
    monster!.facingY = 0;

    world.tick(0.05);

    expect(monster!.targetPlayerId).toBeUndefined();
  });

  it('시야각 경계 안(전방 60도)에 들어오면 어그로가 잡힌다', () => {
    const world = new World();
    // 몬스터가 +x를 바라볼 때, 45도 방향은 시야각(±60도) 안이다.
    world.addPlayer('front-diagonal', 50, 50);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = 0;
    monster!.y = 0;
    monster!.facingX = 1;
    monster!.facingY = 0;

    world.tick(0.05);

    expect(monster!.targetPlayerId).toBe('front-diagonal');
  });

  it('한 번 잡은 타겟은 몬스터가 지나쳐서 시야각 밖으로 나가도(leash 안이면) 유지한다', () => {
    const world = new World();
    world.addPlayer('near', 0, 0);
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'rusher';
    monster!.x = 10;
    monster!.y = 0;
    monster!.facingX = -1;
    monster!.facingY = 0;

    world.tick(0.05); // 타겟 획득('near')
    expect(monster!.targetPlayerId).toBe('near');

    // 추격하다 타겟을 지나쳐(등 뒤로 두고) 반대편으로 이동한 상황을 흉내낸다 —
    // 시야각은 "처음 발견"에만 걸리고 추격 유지에는 걸리지 않아야 하므로 타겟을 유지해야 한다.
    monster!.x = -5;
    monster!.facingX = -1; // 계속 -x로 나아가는 중이라 'near'(0,0)는 이제 등 뒤(+x쪽)다
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBe('near');
  });
});

describe('World — debugJumpToWave(테스트용)', () => {
  it('지정한 웨이브로 이동하고 그 웨이브의 몬스터가 스폰된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);

    world.debugJumpToWave(5);

    expect(world.getWavePhase()).toBe('night');
    expect(world.getCurrentWave()).toBe(5);

    spawnAtLeast(world, 1);
    expect(world.getMonsters().size).toBeGreaterThan(0);
  });

  it('이전 웨이브에서 남아있던 몬스터를 정리하고 새 웨이브 몬스터만 남긴다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500); // 몬스터가 코어로 직행하도록 멀리 둔다
    startFirstWave(world);
    spawnAtLeast(world, 1);
    expect(world.getMonsters().size).toBeGreaterThan(0); // 1웨이브 몬스터가 있는 상태

    world.debugJumpToWave(5);

    // 점프 직후엔 5웨이브 스폰이 아직 시작 전이라 몬스터가 하나도 없어야 한다
    // (1웨이브 몬스터가 남아있었다면 이 값이 0이 아니었을 것).
    expect(world.getMonsters().size).toBe(0);
  });

  it('코어/플레이어 HP는 건드리지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.getPlayers().get('p1')!.hp = 42;

    world.debugJumpToWave(5);

    expect(world.getCore().hp).toBe(world.getCore().maxHp);
    expect(world.getPlayers().get('p1')!.hp).toBe(42);
  });

  it('존재하지 않는 웨이브 번호는 무시하고 기존 몬스터도 그대로 둔다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    startFirstWave(world);
    spawnAtLeast(world, 1);
    const aliveBefore = world.getMonsters().size;

    world.debugJumpToWave(9999);

    expect(world.getMonsters().size).toBe(aliveBefore);
    expect(world.getCurrentWave()).toBe(1);
  });
});
