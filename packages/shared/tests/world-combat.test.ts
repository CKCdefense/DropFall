import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { monstersData, wavesData } from '../src/data';

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

/**
 * 예전 시작 지급품(권총/도끼/곡괭이/붕대)을 손에 쥐여준다. 이제 도구는 팀 창고에서
 * 시작하므로(loadout.coreStorage), 장착을 전제하는 테스트는 명시적으로 꺼내 쓴다.
 * 슬롯 순서는 예전과 같아서 기존 selectSlot 번호가 그대로 유효하다.
 */
/** 인벤토리 전체에서 특정 아이템 개수. 자원이 전용 숫자 필드에서 아이템이 됐다. */
function carriedCount(world: World, playerId: string, itemId: string): number {
  return world.getPlayers().get(playerId)!.inventory.countOf(itemId);
}

/** 바닥에 떨어진 특정 아이템 개수. 몬스터 처치 보상도 바닥에 떨어진다. */
function droppedCount(world: World, itemId: string): number {
  let total = 0;
  for (const drop of world.getDroppedItems().values()) {
    if (drop.itemId === itemId) total += drop.count;
  }
  return total;
}

function equipDefaultKit(world: World, playerId: string): void {
  const inventory = world.getPlayers().get(playerId)!.inventory;
  inventory.add('pistol', 1);
  inventory.add('axe_t1', 1);
  inventory.add('pickax_t1', 1);
  inventory.add('bandage', 3);
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
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    // 스폰된 몬스터 중 하나를 플레이어 바로 옆으로 옮겨서 근접 사거리 안에 둔다
    const [monster] = [...world.getMonsters().values()];
    expect(monster).toBeDefined();
    monster!.x = 5;
    monster!.y = 0;
    const initialHp = monster!.hp;

    // 시작 지급품 순서는 loadout.json 기준: 0=권총 1=도끼 2=곡괭이 3=붕대
    world.selectSlot('p1', 1);
    world.fireWeapon('p1');

    expect(monster!.hp).toBe(initialHp - 18); // axe damage = 18
  });

  it('몬스터 타입마다 다른 히트박스 반경으로 판정한다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    // trash의 hitRadius는 6. 총알은 중심에서 6px 안으로 들어와야 맞는다.
    monster!.x = 200;
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1'); // 권총, +x 방향
    for (let i = 0; i < 120 && world.getProjectiles().size > 0; i += 1) world.tick(1 / 60);

    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('히트박스 반경 밖으로 스쳐 지나가면 맞지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    // 진행선(+x)에서 세로로 hitRadius(6)보다 멀리 떨어뜨린다
    monster!.x = 200;
    monster!.y = 12;
    const initialHp = monster!.hp;

    world.fireWeapon('p1');
    for (let i = 0; i < 120 && world.getProjectiles().size > 0; i += 1) world.tick(1 / 60);

    expect(monster!.hp).toBe(initialHp);
  });

  it('사거리 밖 몬스터는 근접 공격이 닿지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 10000;
    monster!.y = 10000;
    const initialHp = monster!.hp;

    world.selectSlot('p1', 1);
    world.fireWeapon('p1');

    expect(monster!.hp).toBe(initialHp);
  });

  it('권총(원거리)은 투사체를 만들고, 투사체가 이동해 몬스터에 맞으면 데미지를 준다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 100;
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1'); // 기본 선택 슬롯이 권총. aimAngle 기본 0 → +x 방향으로 발사
    expect(world.getProjectiles().size).toBe(1);

    // 실제 서버는 60Hz(≈0.0167s) 단위로 tick()을 호출한다 — 한 번에 큰 dt로 틱하면
    // 투사체가 몬스터를 한 프레임 만에 통과해버려(터널링) 충돌을 놓칠 수 있다.
    for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) {
      world.tick(1 / 60);
    }

    expect(world.getProjectiles().size).toBe(0); // 명중 후 소멸
    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('몬스터가 총구 간격(0~muzzleOffset) 안에 붙어 있으면 투사체 없이 즉시 명중한다', () => {
    // 회귀 테스트: 투사체가 플레이어 좌표가 아니라 muzzleOffset(pistol=19px)만큼
    // 떨어진 "총구" 좌표에서 생겨나다 보니, 돌진형 몬스터가 그보다 더 가까이
    // 파고들면 투사체가 몬스터를 이미 지나친 자리에서 시작해 조준이 정확해도
    // 영원히 못 맞히는 버그가 있었다(총구가 생기기도 전에 몸이 막고 있었는데,
    // 그 구간 자체를 아무도 검사하지 않았다).
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 8; // pistol muzzleOffset(19)보다 훨씬 가깝다
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1'); // 기본 슬롯 = 권총, aimAngle 기본 0 → +x(몬스터 쪽)

    expect(world.getProjectiles().size).toBe(0); // 총구 간격에서 이미 맞아서 안 날아간다
    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('총구 간격 밖의 몬스터는 평소처럼 투사체가 날아가 맞힌다(간격 안 판정이 먼 거리 사격을 막지 않는다)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 40; // muzzleOffset(19)보다 충분히 멀다
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1');
    expect(world.getProjectiles().size).toBe(1); // 이번엔 정상적으로 투사체가 생긴다

    for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) {
      world.tick(1 / 60);
    }

    expect(world.getProjectiles().size).toBe(0);
    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('쿨다운이 끝나기 전에 다시 발사하면 무시된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 5;
    monster!.y = 0;

    world.selectSlot('p1', 1);
    world.fireWeapon('p1');
    const hpAfterFirst = monster!.hp;
    world.fireWeapon('p1'); // 도끼 fireRate 1.5 → 0.67초 간격, 아직 안 지남

    expect(monster!.hp).toBe(hpAfterFirst);
  });

  it('무기가 아닌 슬롯(붕대)을 들고 있으면 공격이 성립하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    world.selectSlot('p1', 3); // 붕대
    world.fireWeapon('p1');

    expect(world.getProjectiles().size).toBe(0);
  });

  it('슬롯 번호가 이상해도 크래시하지 않고 선택이 바뀌지 않는다(클라이언트 입력 불신)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    for (const bad of [-1, 99, 1.5, '1', null, undefined, NaN]) {
      expect(() => world.selectSlot('p1', bad)).not.toThrow();
    }

    // 기본값(0번 = 권총)이 유지되므로 발사가 정상 동작한다
    world.fireWeapon('p1');
    expect(world.getProjectiles().size).toBe(1);
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
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 10, 10);
    equipDefaultKit(world, 'p2');

    world.getPlayers().get('p1')!.hp = 0;
    world.getPlayers().get('p2')!.hp = 0;
    world.tick(0.1);

    expect(world.getWavePhase()).toBe('defeat');
  });

  it('일부만 다운됐으면 패배가 아니다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 10, 10);
    equipDefaultKit(world, 'p2');

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
    equipDefaultKit(world, 'down');
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
    equipDefaultKit(world, 'p1');
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
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 0, 0);
    equipDefaultKit(world, 'p2');

    world.castSkipVote('p1');
    expect(world.getWavePhase()).toBe('day'); // 아직 한 명 남음

    world.castSkipVote('p2');
    expect(world.getWavePhase()).toBe('night');
  });

  it('night 페이즈에서는 투표해도 효과가 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    world.castSkipVote('p1');
    expect(world.getWavePhase()).toBe('night'); // 그대로 유지, 다음 웨이브로 안 넘어감
  });

  it('존재하지 않는 플레이어의 투표는 무시된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');

    expect(() => world.castSkipVote('ghost')).not.toThrow();
    expect(world.getWavePhase()).toBe('day');
  });

  it('투표한 플레이어가 퇴장하면 그 표는 사라진다(새로 들어온 인원 기준으로 다시 만장일치 필요)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 0, 0);
    equipDefaultKit(world, 'p2');

    world.castSkipVote('p1');
    world.removePlayer('p1');
    world.addPlayer('p3', 0, 0);
    equipDefaultKit(world, 'p3');

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
    equipDefaultKit(world, 'near');
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
    equipDefaultKit(world, 'near');
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
    equipDefaultKit(world, 'down');
    world.addPlayer('alive', 20, 0);
    equipDefaultKit(world, 'alive');
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
    equipDefaultKit(world, 'front-diagonal');
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
    equipDefaultKit(world, 'near');
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
    equipDefaultKit(world, 'p1');

    world.debugJumpToWave(5);

    expect(world.getWavePhase()).toBe('night');
    expect(world.getCurrentWave()).toBe(5);

    spawnAtLeast(world, 1);
    expect(world.getMonsters().size).toBeGreaterThan(0);
  });

  it('이전 웨이브에서 남아있던 몬스터를 정리하고 새 웨이브 몬스터만 남긴다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    equipDefaultKit(world, 'p1'); // 몬스터가 코어로 직행하도록 멀리 둔다
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
    equipDefaultKit(world, 'p1');
    world.getPlayers().get('p1')!.hp = 42;

    world.debugJumpToWave(5);

    expect(world.getCore().hp).toBe(world.getCore().maxHp);
    expect(world.getPlayers().get('p1')!.hp).toBe(42);
  });

  it('존재하지 않는 웨이브 번호는 무시하고 기존 몬스터도 그대로 둔다', () => {
    const world = new World();
    world.addPlayer('p1', 500, 500);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    spawnAtLeast(world, 1);
    const aliveBefore = world.getMonsters().size;

    world.debugJumpToWave(9999);

    expect(world.getMonsters().size).toBe(aliveBefore);
    expect(world.getCurrentWave()).toBe(1);
  });
});

describe('World — 몬스터 처치 보상(부품/에너지)', () => {
  it('흔한 몬스터(잡몹)를 근접 무기로 죽이면 죽은 자리에 부품이 떨어진다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 5;
    monster!.y = 0;
    monster!.hp = 1; // 한 방에 죽도록

    const partsBefore = droppedCount(world, 'drop_normal');
    world.selectSlot('p1', 1); // 도끼
    world.fireWeapon('p1');

    expect(world.getMonsters().has(monster!.id)).toBe(false); // 죽었다
    const gained = droppedCount(world, 'drop_normal') - partsBefore;
    // 부품은 확정 드랍이다 — 확률이 붙은 희귀부품과 달리 매번 min~max 사이로 나온다.
    const drop = monstersData.trash.itemDrops!.find((entry) => entry.itemId === 'drop_normal')!;
    expect(gained).toBeGreaterThanOrEqual(drop.min);
    expect(gained).toBeLessThanOrEqual(drop.max);
  });

  it('원거리 무기(투사체)로 죽여도 부품이 떨어진다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 100;
    monster!.y = 0;
    monster!.hp = 1;

    world.fireWeapon('p1'); // 기본 슬롯 = 권총
    for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) world.tick(1 / 60);

    expect(world.getMonsters().has(monster!.id)).toBe(false);
    expect(droppedCount(world, 'drop_normal')).toBeGreaterThan(0);
  });

  it('총구 간격(muzzle gap) 즉시 명중으로 죽여도 부품이 떨어진다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 8; // muzzleOffset(19)보다 가깝다 — resolveMuzzleGapHit 경로
    monster!.y = 0;
    monster!.hp = 1;

    world.fireWeapon('p1');

    expect(world.getMonsters().has(monster!.id)).toBe(false);
    expect(droppedCount(world, 'drop_normal')).toBeGreaterThan(0);
  });

  it('보스를 죽이면 바닥 드랍 대신 팀 공유 에너지가 늘어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    // 실제 5웨이브까지 자연스럽게 보스가 스폰되길 기다리면(수백 초) 그 사이 몬스터
    // 무리가 코어/플레이어를 먼저 전멸시켜버린다 — 다른 테스트들과 같은 트릭으로
    // 이미 스폰된 몬스터의 타입을 보스로 바꿔서 처치 보상 로직만 정확히 검증한다.
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'boss';
    monster!.x = 5;
    monster!.y = 0;
    monster!.hp = 1;

    const energyBefore = world.getCore().sharedEnergy;
    world.selectSlot('p1', 1);
    world.fireWeapon('p1');

    expect(world.getMonsters().has(monster!.id)).toBe(false);
    expect(droppedCount(world, 'drop_normal')).toBe(0); // 보스 보상은 에너지 한 갈래뿐이다
    const gained = world.getCore().sharedEnergy - energyBefore;
    const drop = monstersData.boss.energyDrop!;
    expect(gained).toBeGreaterThanOrEqual(drop.min);
    expect(gained).toBeLessThanOrEqual(drop.max);
  });

  it('부품은 인벤토리에 들어오고, 창고로 끌어다 놓으면 팀 공유분이 된다', () => {
    const world = new World();
    world.addPlayer('p1', 10, 0); // 코어 상호작용 반경 안
    world.getPlayers().get('p1')!.inventory.add('drop_normal', 5);

    // 인벤토리 0번 → 창고 첫 빈 칸(초기 지급품 4개 다음)
    world.moveItem('p1', 'inventory', 0, 'storage', 4);

    expect(carriedCount(world, 'p1', 'drop_normal')).toBe(0);
    expect(world.getCore().storage.countOf('drop_normal')).toBe(5);
  });

  it('투사체가 날아가는 동안 쏜 플레이어가 퇴장해도 처치 판정 자체는 크래시 없이 그대로 된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 100;
    monster!.y = 0;
    monster!.hp = 1;

    world.fireWeapon('p1'); // 발사 — 아직 몬스터에 안 닿음
    world.removePlayer('p1'); // 발사 직후 퇴장(명중 시점에 쏜 사람이 없다)

    expect(() => {
      for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) world.tick(1 / 60);
    }).not.toThrow();
    expect(world.getMonsters().has(monster!.id)).toBe(false); // 판정 자체는 그대로 적용된다
  });
});
