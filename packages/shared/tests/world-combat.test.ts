import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { craftingData, jobsData, monstersData, wavesData } from '../src/data';
import { SLOT_COUNT } from '../src/sim/inventory';

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
 * 고정된 4칸 구성(권총/도끼/곡괭이/붕대)을 손에 쥐여준다. 실제 시작 지급품은 창고
 * (loadout.coreStorage)와 붕대 1개뿐이라, 장착을 전제하는 테스트는 여기서 직접 채운다.
 * 슬롯 번호가 고정되어야 selectSlot으로 특정 무기를 지목할 수 있다.
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
  // 참가 지급품(붕대 1개)을 먼저 비운다 — 슬롯 번호를 고정해야 selectSlot 테스트가 성립한다.
  for (let index = 0; index < SLOT_COUNT; index += 1) inventory.takeAt(index);
  inventory.add('handgun', 1);
  inventory.add('axe_t1', 1);
  inventory.add('pickax_t1', 1);
  inventory.add('bandage', 3);
}


/**
 * 자원 노드를 전부 멀리 치운다.
 *
 * `new World()`는 rng를 안 주면 `Math.random`으로 노드를 배치한다 — 코어 260px 밖
 * 어디든 올 수 있어서, 테스트가 몬스터/플레이어를 특정 좌표에 세우면 그 자리에
 * 노드가 겹칠 확률이 늘 남는다. 노드는 **투사체를 흡수하고 이동도 막아서**, 겹치면
 * 사격이 빗나가거나 몬스터가 그 자리에 굳는다(실제로 두 종류 모두 간헐 실패로 겪었다).
 * 무대를 쓰는 테스트는 전부 이걸 먼저 부른다.
 */
function clearResourceNodes(world: World): void {
  for (const node of world.getResourceNodes().values()) {
    node.x = 5000;
    node.y = 5000;
  }
}

/**
 * 테스트 대상 몬스터 한 마리만 남기고 나머지를 치운 뒤, 타입까지 고정해서 돌려준다.
 *
 * 웨이브 1이 여러 타입을 무리로 쏟아내면서(demon/hellhound) "첫 번째 몬스터"의 체력·
 * 속도·시야가 판마다 달라졌다 — 정확한 수치를 등호로 비교하는 테스트들이 이것 때문에
 * 간헐적으로 깨졌다. 남은 몬스터들도 분리력으로 대상을 밀어내 무대를 흐트러뜨린다.
 */
function isolateMonster(world: World, type = 'demon'): { x: number; y: number; hp: number } {
  const monsters = world.getMonsters() as Map<string, { type: string; hp: number; maxHp: number }>;
  const [first] = [...monsters.entries()];
  for (const [id] of [...monsters]) if (id !== first![0]) monsters.delete(id);

  const monster = first![1];
  monster.type = type;
  monster.hp = monstersData[type]!.hp;
  monster.maxHp = monstersData[type]!.hp;
  return monster as unknown as { x: number; y: number; hp: number };
}

/**
 * 몬스터를 제자리에 붙들어 둔다. 탄도 기하(스쳐 지나가는가)를 재는 테스트는 몬스터가
 * 가만히 있어야 의미가 있는데, 실제로는 코어를 향해 걸어간다 — 게다가 콜로니가 시야를
 * 막으면 Flow Field의 8방향 양자화 때문에 대각선으로 움직여서 탄도선을 가로지른다
 * (총알이 스쳐 가야 할 테스트에서 12 피해가 들어가는 간헐 실패로 드러났다).
 */
function pinAt(monster: { x: number; y: number }, x: number, y: number): void {
  monster.x = x;
  monster.y = y;
}


/**
 * 큰 dt 한 번으로는 공격이 정산되지 않는다 — 이제 모든 공격이 "시도 → 예고 → 판정"
 * 3단계라, 시도한 틱과 정산되는 틱이 다르다(실제 서버는 60Hz라 무관하다).
 * 테스트는 실제 틱레이트에 가깝게 잘게 굴린다.
 */
function tickSeconds(world: World, seconds: number, step = 0.02): void {
  const steps = Math.max(1, Math.round(seconds / step));
  for (let i = 0; i < steps; i += 1) world.tick(step);
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

    // 대상 한 마리만 남기고 플레이어 바로 옆으로 옮겨 근접 사거리 안에 둔다.
    // demon으로 고정하는 이유: hellhound(hp 16)면 도끼 한 방(18)에 죽어 엔티티가
    // 삭제되고, 삭제 경로는 로컬 참조의 hp를 갱신하지 않아 "hp가 그대로"로 보였다.
    const monster = isolateMonster(world);
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
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world);
    // demon의 hitRadius는 6. 총알은 중심에서 6px 안으로 들어와야 맞는다.
    monster!.x = 500;
    monster!.y = 0;
    const initialHp = monster!.hp;

    world.fireWeapon('p1'); // 권총, +x 방향
    for (let i = 0; i < 120 && world.getProjectiles().size > 0; i += 1) {
      pinAt(monster, 500, 0);
      world.tick(1 / 60);
    }

    expect(monster!.hp).toBeLessThan(initialHp);
  });

  it('히트박스 반경 밖으로 스쳐 지나가면 맞지 않는다', () => {
    const world = new World();
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world);
    // 진행선(+x)에서 세로로 hitRadius(6)보다 멀리 떨어뜨린다
    monster!.x = 500;
    monster!.y = 12;
    const initialHp = monster!.hp;

    world.fireWeapon('p1');
    for (let i = 0; i < 120 && world.getProjectiles().size > 0; i += 1) {
      pinAt(monster, 500, 12);
      world.tick(1 / 60);
    }

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
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 400;
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
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 340; // muzzleOffset(19)보다 충분히 멀다
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
    tickSeconds(world, 1.5); // 예고 + attackInterval이 지나도록

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
    tickSeconds(world, 1.5);

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

    // hellhound(돌진형)를 다운된 플레이어=코어 바로 옆에 둔다(둘 다 원점 근처).
    // wave 1엔 hellhound가 없으므로 스폰된 몬스터의 타입을 바꿔서 검증한다.
    startFirstWave(world);
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound';
    monster!.x = 1;
    monster!.y = 0;

    const coreHpBefore = world.getCore().hp;
    tickSeconds(world, 2); // 예고 + attackInterval을 넘기도록

    // 다운된 플레이어를 어그로 대상으로 잡았다면 코어는 공격받지 않았을 것이다(continue로 스킵).
    // 코어 HP가 깎였다는 건 몬스터가 다운된 플레이어를 무시하고 코어 쪽 로직을 탔다는 뜻이다.
    expect(world.getCore().hp).toBeLessThan(coreHpBefore);
  });

  it('밤 내내 쓰러져 있던 플레이어는 유령이 되어 아침에도 돌아오지 못한다', () => {
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
      world.tick(wave1.groupIntervalSeconds / 4);
      for (const id of [...monsters.keys()]) monsters.delete(id);
    }

    expect(world.getWavePhase()).toBe('day');

    /*
     * 쓰러진 지 30초가 지나 유령이 됐으므로 아침이 와도 일어나지 않는다 — 유령을
     * 되돌리는 길은 낮에 코어에서 에너지를 치르는 것 하나뿐이다(reviveGhostAtCore).
     * 여기서 공짜로 세워 주면 그 대가가 통째로 사라진다.
     */
    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');
    expect(world.getPlayers().get('p1')!.hp).toBe(0);
  });

  it('밤이 끝나는 순간에 쓰러진 플레이어는 아침에 절반 체력으로 일어난다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 0, 0);
    startFirstWave(world);

    const monsters = world.getMonsters() as unknown as Map<string, unknown>;
    const wave1 = wavesData.waves[0]!;
    for (let i = 0; i < 5000 && world.getWavePhase() === 'night'; i += 1) {
      /*
       * 매 틱 다시 눕힌다 = **계속 얻어맞아 방금 쓰러진 상태**로 아침을 맞는다.
       * 한 번만 눕히면 30초 뒤 유령이 되는데, 밤 길이는 웨이브 구성과 인원수
       * 스케일링이 정하는 값이라 "유령이 되기 전에 아침이 오는" 밤을 테스트가
       * 임의로 만들 수 없다.
       */
      const p1 = world.getPlayers().get('p1')!;
      p1.hp = 0;
      p1.lifeState = 'alive';
      world.tick(wave1.groupIntervalSeconds / 4);
      for (const id of [...monsters.keys()]) monsters.delete(id);
    }

    expect(world.getWavePhase()).toBe('day');

    // 되살아나되 **가득 차지는 않는다** — 풀피로 되살리면 살아남는 것보다 죽는 편이
    // 이득이 된다(World.REVIVE_HP_RATIO).
    const revived = world.getPlayers().get('p1')!.hp;
    expect(revived).toBeGreaterThan(0);
    expect(revived).toBeLessThan(jobsData.base.maxHp);
  });

  it('새 낮이 와도 살아남은 플레이어의 체력은 채워주지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    world.addPlayer('p2', 0, 0);
    startFirstWave(world);

    const hurt = Math.round(jobsData.base.maxHp * 0.4);
    world.getPlayers().get('p1')!.hp = hurt;

    const monsters = world.getMonsters() as unknown as Map<string, unknown>;
    const wave1 = wavesData.waves[0]!;
    for (let i = 0; i < 5000 && world.getWavePhase() === 'night'; i += 1) {
      // 매 틱 다시 깎아 둔다 — 그래야 아침을 **다친 채로** 맞는다. 한 번만 깎으면
      // 밤이 길어(웨이브 인원수 스케일링) 자연 재생만으로 가득 차 버려서, 아침이
      // 채워 준 것인지 밤새 아문 것인지 구분할 수 없다.
      world.getPlayers().get('p1')!.hp = hurt;
      world.tick(wave1.groupIntervalSeconds / 4);
      for (const id of [...monsters.keys()]) monsters.delete(id);
    }

    expect(world.getWavePhase()).toBe('day');
    /*
     * **전환 순간에 뛰지 않았는가**를 본다.
     *
     * 재생으로 차는 것과 아침이 채워 주는 것은 다른 얘기다 — 이 테스트가 못 박으려는
     * 건 뒤쪽이라, 밤새 아무는 몫을 위에서 걷어내고 전환만 본다.
     */
    const dawn = world.getPlayers().get('p1')!.hp;
    expect(dawn).toBeGreaterThan(0);
    expect(dawn).toBeLessThan(jobsData.base.maxHp);
  });
});

/** dropItem은 private이지만, "바닥에 뭔가 있는 상태"를 준비하는 데는 이 방법이 제일 짧다
 * (economy.test.ts의 killMonster와 같은 패턴 — private 메서드를 캐스팅해서 부른다). */
function forceDropItem(world: World, itemId: string, count: number, x: number, y: number): void {
  (
    world as unknown as {
      dropItem(itemId: string, count: number, x: number, y: number): void;
    }
  ).dropItem(itemId, count, x, y);
}

describe('World — 다운된(hp 0) 플레이어는 아무 동작도 할 수 없다', () => {
  it('쓰러진 채로는 움직이지 못한다 — 기어다니면 동료가 구조를 채울 수 없다', () => {
    const world = new World();
    // 코어 발자국 밖(코어는 원점)에서 시작해야 이동 자체가 코어 충돌에 막히지 않는다.
    world.addPlayer('p1', 200, 200);
    world.getPlayers().get('p1')!.hp = 0;

    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });
    world.tick(0.5);

    const player = world.getPlayers().get('p1')!;
    expect(player.lifeState).toBe('downed');
    expect(player.x).toBe(200);
  });

  it('공격해도 투사체가 생기지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    world.selectSlot('p1', 0); // 권총(원거리)
    world.getPlayers().get('p1')!.hp = 0;

    world.fireWeapon('p1');

    expect(world.getProjectiles().size).toBe(0);
  });

  it('바닥 드롭을 주울 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    forceDropItem(world, 'wood', 3, 0, 0);
    world.getPlayers().get('p1')!.hp = 0;

    world.pickUpNearestDrop('p1');

    expect(carriedCount(world, 'p1', 'wood')).toBe(0);
    expect(droppedCount(world, 'wood')).toBe(3); // 바닥에 그대로 남았다
  });

  it('재료가 충분해도 제작할 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    const recipe = craftingData.recipes.find((entry) => entry.id === 'axe_t1')!;
    for (const [itemId, count] of Object.entries(recipe.cost)) {
      world.getCore().storage.add(itemId, count);
    }
    world.getPlayers().get('p1')!.hp = 0;
    // 창고에는 시작 지급품(loadout.coreStorage)이 이미 들어 있을 수 있어서(economy.test.ts와
    // 같은 이유) 절대량이 아니라 변화량으로 본다.
    const before = world.getCore().storage.countOf(recipe.itemId);

    world.craftItem('p1', recipe.id);

    expect(world.getCore().storage.countOf(recipe.itemId)).toBe(before);
  });

  it('건축 아이템을 들고 있어도 설치할 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.takeAt(0);
    inventory.add('fence', 1);
    world.selectSlot(
      'p1',
      inventory.toView().slots.findIndex((slot) => slot?.itemId === 'fence'),
    );
    world.getPlayers().get('p1')!.hp = 0;

    world.placeHeldBuilding('p1', 3, 3);

    expect(world.getBuildings().size).toBe(0);
  });

  it('투표해도 표가 안 들어간다(혼자인 방에서 즉시 스킵되지 않는지로 확인)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.getPlayers().get('p1')!.hp = 0;

    world.castSkipVote('p1');

    // 살아있었다면 1인 방에서 혼자 투표한 순간 만장일치라 바로 낮이 끝났을 것이다.
    expect(world.getWavePhase()).toBe('day');
  });

  it('에너지가 충분해도 코어를 업그레이드할 수 없다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    const tierBefore = world.getCore().tier;
    world.getCore().energy = 999999;
    world.getPlayers().get('p1')!.hp = 0;

    world.upgradeCore('p1');

    expect(world.getCore().tier).toBe(tierBefore);
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
    clearResourceNodes(world);

    // 스폰된 몬스터 중 둘을 분리 반경(HIT_RADIUS*2.5=25px) 안으로 바짝 붙여놓는다.
    // 두 마리의 타입(=이동 속도)을 같게 고정한다 — 웨이브 1이 demon(60)/hellhound(130)
    // 혼성이 되면서, 뒤쪽이 hellhound면 분리력보다 빠르게 따라붙어 간헐 실패했다.
    const monsters = [...world.getMonsters().values()];
    (monsters[0] as { type: string }).type = 'demon';
    (monsters[1] as { type: string }).type = 'demon';
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
    clearResourceNodes(world);

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
    (monster as { type: string }).type = 'hellhound'; // aggroRadius 240
    // **공격 사거리(20) 밖**에 둔다 — 한 대 때리면 타겟을 놓고 다시 고르는 규칙이라
    // (§clearAggroAfterAttack), 붙여 두면 leash가 아니라 그 규칙을 보게 된다.
    monster!.x = 100;
    monster!.y = 0;
    monster!.facingX = -1; // 플레이어('near', 원점) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05); // 타겟 획득
    expect(monster!.targetPlayerId).toBe('near');

    // 아그로 반경(240) 밖이지만 leash(240*1.5=360) 안으로 플레이어를 이동시킨다.
    world.getPlayers().get('near')!.x = monster!.x + 300;
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBe('near');
  });

  it('leash 반경 밖으로 나가면 타겟을 놓치고 코어 쪽으로 돌아선다', () => {
    const world = new World();
    world.addPlayer('near', 0, 0);
    equipDefaultKit(world, 'near');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound';
    monster!.x = 100; // 공격 사거리 밖 = 추격 상태
    monster!.y = 0;
    monster!.facingX = -1; // 플레이어('near', 원점) 쪽을 바라보게 시야각 안에 둔다
    monster!.facingY = 0;

    world.tick(0.05);
    expect(monster!.targetPlayerId).toBe('near');

    // leash(360)보다 멀리 이동 — 더 이상 근처에 다른 플레이어도 없으므로 타겟이 사라져야 한다.
    world.getPlayers().get('near')!.x = 2000;
    world.tick(0.05);

    expect(monster!.targetPlayerId).toBeUndefined();
  });

  it('타겟이 다운되면(hp 0) 다른 대상으로 넘어간다', () => {
    const world = new World();
    world.addPlayer('down', 60, 0);
    equipDefaultKit(world, 'down');
    world.addPlayer('alive', 120, 0);
    equipDefaultKit(world, 'alive');
    startFirstWave(world);

    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'hellhound';
    monster!.x = 0;
    monster!.y = 0;
    // 둘 다 공격 사거리(20) 밖에 둔다 — 때리는 순간 타겟을 놓는 규칙과 섞이지 않게.
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
    (monster as { type: string }).type = 'hellhound'; // aggroRadius 240
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
    (monster as { type: string }).type = 'hellhound';
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
    (monster as { type: string }).type = 'hellhound';
    monster!.x = 100; // 공격 사거리 밖 = 추격 상태
    monster!.y = 0;
    monster!.facingX = -1;
    monster!.facingY = 0;

    world.tick(0.05); // 타겟 획득('near')
    expect(monster!.targetPlayerId).toBe('near');

    // 추격하다 타겟을 지나쳐(등 뒤로 두고) 반대편으로 이동한 상황을 흉내낸다 —
    // 시야각은 "처음 발견"에만 걸리고 추격 유지에는 걸리지 않아야 하므로 타겟을 유지해야 한다.
    monster!.x = -60;
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
  /**
   * 부품 드랍은 예전엔 확정(chance:1)이었는데, 게임 흐름 피드백(docs/backend/70) —
   * "몬스터 수가 늘어난 뒤로 바닥에 흩어진 부품을 일일이 줍느라 아침 준비 시간이
   * 모자라다" — 를 받아 확률을 50%로 낮추는 대신 개수를 늘렸다(§monsters.json
   * drop_normal). 그래서 "한 마리 죽이면 반드시 드랍"을 더 이상 전제할 수 없다 —
   * 이 describe의 테스트들은 드랍을 볼 때까지 여러 마리를 죽여 가며 재시도한다
   * (실패 확률이 0.5^n로 지수적으로 줄어서 몇 번 안에 사실상 항상 성공한다).
   */
  const DROP_RETRY_LIMIT = 40;

  it('흔한 몬스터(잡몹)를 근접 무기로 죽이면 죽은 자리에 부품이 떨어진다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    world.selectSlot('p1', 1); // 도끼

    const drop = monstersData.demon.itemDrops!.find((entry) => entry.itemId === 'drop_normal')!;
    let gained = 0;
    for (let i = 0; i < DROP_RETRY_LIMIT && gained === 0; i += 1) {
      world.runDevCommand('p1', 'spawn demon 1');
      // 이전 시도의 fireWeapon이 무기 쿨다운을 걸어 놨다 — 시간을 흘려보내 비운다
      // (안 그러면 재시도의 fireWeapon이 조용히 무시된다).
      world.tick(1);
      const monster = [...world.getMonsters().values()].find((m) => m.type === 'demon')!;
      monster.x = 5;
      monster.y = 0;
      monster.hp = 1; // 한 방에 죽도록

      const partsBefore = droppedCount(world, 'drop_normal');
      world.fireWeapon('p1');
      expect(world.getMonsters().has(monster.id)).toBe(false); // 죽었다
      gained = droppedCount(world, 'drop_normal') - partsBefore;
    }

    // 드랍이 났을 때는(확률을 뚫었을 때는) 여전히 min~max 사이로 확정이다.
    expect(gained).toBeGreaterThanOrEqual(drop.min);
    expect(gained).toBeLessThanOrEqual(drop.max);
  });

  it('원거리 무기(투사체)로 죽여도 부품이 떨어진다', () => {
    const world = new World();
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    let gained = false;
    for (let i = 0; i < DROP_RETRY_LIMIT && !gained; i += 1) {
      world.runDevCommand('p1', 'spawn demon 1');
      const monster = [...world.getMonsters().values()].find((m) => m.type === 'demon')!;
      monster.x = 400;
      monster.y = 0;
      monster.hp = 1;

      const before = droppedCount(world, 'drop_normal');
      world.fireWeapon('p1'); // 기본 슬롯 = 권총
      for (let t = 0; t < 60 && world.getProjectiles().size > 0; t += 1) world.tick(1 / 60);
      expect(world.getMonsters().has(monster.id)).toBe(false);
      gained = droppedCount(world, 'drop_normal') > before;
    }

    expect(gained).toBe(true);
  });

  it('총구 간격(muzzle gap) 즉시 명중으로 죽여도 부품이 떨어진다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    let gained = false;
    for (let i = 0; i < DROP_RETRY_LIMIT && !gained; i += 1) {
      world.runDevCommand('p1', 'spawn demon 1');
      // 이전 시도의 fireWeapon이 무기 쿨다운을 걸어 놨다 — 시간을 흘려보내 비운다.
      world.tick(1);
      const monster = [...world.getMonsters().values()].find((m) => m.type === 'demon')!;
      monster.x = 8; // muzzleOffset(19)보다 가깝다 — resolveMuzzleGapHit 경로
      monster.y = 0;
      monster.hp = 1;

      const before = droppedCount(world, 'drop_normal');
      world.fireWeapon('p1');
      expect(world.getMonsters().has(monster.id)).toBe(false);
      gained = droppedCount(world, 'drop_normal') > before;
    }

    expect(gained).toBe(true);
  });

  it('보스를 죽이면 팀 공유 에너지와 바닥 드랍을 둘 다 준다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);

    // 실제 5웨이브까지 자연스럽게 보스가 스폰되길 기다리면(수백 초) 그 사이 몬스터
    // 무리가 코어/플레이어를 먼저 전멸시켜버린다 — 다른 테스트들과 같은 트릭으로
    // 이미 스폰된 몬스터의 타입을 보스로 바꿔서 처치 보상 로직만 정확히 검증한다.
    const [monster] = [...world.getMonsters().values()];
    (monster as { type: string }).type = 'boss_demon';
    monster!.x = 5;
    monster!.y = 0;
    monster!.hp = 1;

    const energyBefore = world.getCore().energy;
    world.selectSlot('p1', 1);
    world.fireWeapon('p1');

    expect(world.getMonsters().has(monster!.id)).toBe(false);
    // 보스는 에너지와 바닥 드랍을 **둘 다** 준다 — 레이드 보상 체감을 위해
    // 예전의 "에너지가 있으면 드랍 생략" 규칙을 없앴다.
    expect(droppedCount(world, 'drop_normal')).toBeGreaterThan(0);
    const gained = world.getCore().energy - energyBefore;
    const drop = monstersData.boss_demon.energyDrop!;
    expect(gained).toBeGreaterThanOrEqual(drop.min);
    expect(gained).toBeLessThanOrEqual(drop.max);
  });

  it('부품은 인벤토리에 들어오고, 창고로 끌어다 놓으면 팀 공유분이 된다', () => {
    const world = new World();
    world.addPlayer('p1', 10, 0); // 코어 상호작용 반경 안
    world.getPlayers().get('p1')!.inventory.add('drop_normal', 5); // 0번은 참가 지급 붕대

    // 인벤토리 1번 → 창고 첫 빈 칸(초기 지급품 도구 3종 다음)
    world.moveItem('p1', 'inventory', 1, 'storage', 3);

    expect(carriedCount(world, 'p1', 'drop_normal')).toBe(0);
    expect(world.getCore().storage.countOf('drop_normal')).toBe(5);
  });

  it('투사체가 날아가는 동안 쏜 플레이어가 퇴장해도 처치 판정 자체는 크래시 없이 그대로 된다', () => {
    const world = new World();
    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구(x≈25)가 코어 안이라 투사체가 흡수된다.
    world.addPlayer('p1', 300, 0);
    equipDefaultKit(world, 'p1');
    startFirstWave(world);
    clearResourceNodes(world);

    const [monster] = [...world.getMonsters().values()];
    monster!.x = 400;
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

describe('World — 어그로 규칙(공격 1회 → 재탐색)', () => {
  /**
   * 규칙: 시야 안 가장 가까운 플레이어를 잡고 → 사거리에서 한 번 때리고 → 다시 고른다.
   * 시야 안에 아무도 없을 때만 코어로 향한다. 멀티/싱글 공통이다.
   */
  it('한 대 때리면 타겟을 놓고, 그 사이 더 가까워진 사람으로 갈아탄다', () => {
    // 시야각(전방 120도) 안에 둘 다 세운다 — 등 뒤는 애초에 "시야 내"가 아니라
    // 후보가 되지 않는다(그게 규칙이다).
    const world = new World();
    world.addPlayer('near', 15, 0);
    world.addPlayer('far', 60, 0);
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world, 'hellhound');
    monster.x = 0;
    monster.y = 0;
    (monster as unknown as { facingX: number; facingY: number }).facingX = 1;
    (monster as unknown as { facingX: number; facingY: number }).facingY = 0;

    // 가까운 쪽을 잡고 사거리(20) 안이라 때린다.
    const nearPlayer = world.getPlayers().get('near')!;
    for (let i = 0; i < 200 && nearPlayer.hp === 100; i += 1) {
      world.tick(0.05);
      monster.x = 0;
      monster.y = 0;
    }
    expect(nearPlayer.hp).toBeLessThan(100);
    // 때린 직후에는 타겟을 놓은 상태여야 한다.
    expect(monster.targetPlayerId).toBeUndefined();

    // 이제 거리를 뒤집는다 — 재탐색이 돌면 'far'가 새 타겟이 된다.
    nearPlayer.x = 200;
    world.getPlayers().get('far')!.x = 30;
    world.tick(0.05);

    expect(monster.targetPlayerId).toBe('far');
  });

  it('시야 안에 플레이어가 없을 때만 코어를 때린다', () => {
    const world = new World();
    world.addPlayer('far', 2000, 2000); // 아그로 밖
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world, 'hellhound');
    // 코어 발자국 바로 앞(공격 사거리 안)에 세운다.
    monster.x = 70;
    monster.y = 0;
    monster.attackCooldown = 0;

    const coreBefore = world.getCore().hp;
    tickSeconds(world, 1.5);
    expect(world.getCore().hp).toBeLessThan(coreBefore); // 아무도 없으니 코어를 친다

    // 이제 플레이어가 시야 안에 들어오면 코어 대신 사람을 노린다.
    world.getPlayers().get('far')!.x = monster.x - 40;
    world.getPlayers().get('far')!.y = 0;
    monster.facingX = -1;
    monster.facingY = 0;
    // 한 틱만 돌리면 하필 공격 예고·쿨다운 중일 때 탐색까지 가지 않는다 — 공격 주기가
    // 바뀌어도 깨지지 않게, 타겟을 잡을 때까지 짧게 돌린다(한 주기면 충분하다).
    for (let i = 0; i < 60 && monster.targetPlayerId === undefined; i += 1) world.tick(0.05);

    expect(monster.targetPlayerId).toBe('far');
  });
});

describe('World — 공격 모션 신호(attackSeq)', () => {
  /**
   * 예전엔 "공격 중"(attacking) 불리언의 false→true 전이로 모션을 재생했다. 그런데
   * 모션 길이(예고 + 0.4초)가 공격 주기와 거의 같은 몬스터는 꺼져 있는 구간이 수십 ms뿐이라,
   * 20Hz 상태 동기화가 그 창을 통째로 건너뛰면 클라이언트 눈에는 플래그가 계속 켜져 있어
   * 첫 공격 이후 모션이 영영 안 나왔다(코어를 쉬지 않고 때릴 때 실제로 그랬다).
   */
  it('공격할 때마다 번호가 올라간다 — 모션이 꺼지는 순간을 놓쳐도 재생 시점을 알 수 있다', () => {
    const world = new World();
    world.addPlayer('far', 2000, 2000); // 어그로 밖 — 몬스터가 코어를 노린다
    world.runDevCommand('far', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;
    monster.x = 60;
    monster.y = 0;

    const seqs = new Set<number>();
    const coreBefore = world.getCore().hp;
    // 20Hz(50ms)로만 관측한다 — 실제 클라이언트가 상태를 보는 주기와 같게.
    for (let i = 0; i < 200; i += 1) {
      world.tick(0.05);
      seqs.add(monster.attackSeq);
    }

    expect(world.getCore().hp).toBeLessThan(coreBefore); // 실제로 계속 때리고 있다
    expect(seqs.size).toBeGreaterThan(2); // 때린 횟수만큼 번호가 달라졌다
  });

  it('코어를 때릴 때도 공격 모션이 켜진다', () => {
    const world = new World();
    world.addPlayer('far', 2000, 2000);
    world.runDevCommand('far', 'spawn demon 1');
    const monster = [...world.getMonsters().values()][0]!;
    monster.x = 60;
    monster.y = 0;

    let sawMotion = false;
    for (let i = 0; i < 200; i += 1) {
      world.tick(0.05);
      if (monster.attackAnimTimer > 0) sawMotion = true;
    }

    expect(sawMotion).toBe(true);
  });
});

describe('World — 모든 공격은 시도 → 예고 → 판정 → 정산', () => {
  /**
   * 예전에는 사거리에 들어온 순간 곧바로 피해가 들어갔다(보스 평타 포함). 예고가
   * 없으니 피할 방법이 아예 없었고, 그림도 맞은 뒤에야 재생됐다.
   */
  it('사거리에 들어와도 곧바로 맞지 않는다 — 예고 시간이 지나야 정산된다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world, 'demon');
    const player = world.getPlayers().get('p1')!;
    monster.x = 10; // 사거리(20) 안
    monster.y = 0;
    (monster as unknown as { facingX: number; facingY: number }).facingX = -1;
    (monster as unknown as { facingX: number; facingY: number }).facingY = 0;

    const windup = monstersData.demon.attackWindupSeconds;
    // 예고가 끝나기 직전까지는 한 대도 안 맞아야 한다.
    tickSeconds(world, windup * 0.6, 0.01);
    expect(player.hp).toBe(100);

    // 예고를 넘기면 그때 정산된다(자연 회복분 때문에 정수로 딱 떨어지지는 않는다).
    tickSeconds(world, windup, 0.01);
    expect(player.hp).toBeCloseTo(100 - monstersData.demon.damage, 0);
  });

  it('예고 중에 사거리 밖으로 빠지면 헛친다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    startFirstWave(world);
    clearResourceNodes(world);

    const monster = isolateMonster(world, 'demon');
    const player = world.getPlayers().get('p1')!;
    monster.x = 10;
    monster.y = 0;
    (monster as unknown as { facingX: number; facingY: number }).facingX = -1;
    (monster as unknown as { facingX: number; facingY: number }).facingY = 0;

    // 공격을 시도하게 만든다.
    for (let i = 0; i < 20 && monster.pattern.kind !== 'basicSwing'; i += 1) world.tick(0.01);
    expect(monster.pattern.kind).toBe('basicSwing');

    // 예고 중에 멀리 도망친다 — 정산 시점에 사거리 밖이면 안 맞아야 한다.
    player.x = 600;
    player.y = 600;
    tickSeconds(world, monstersData.demon.attackWindupSeconds * 2, 0.01);

    expect(player.hp).toBe(100);
  });

  it('보스는 평타를 쓰지 않는다 — 모든 기술이 쿨다운이면 아무것도 안 치고 기다린다', () => {
    const world = new World();
    world.addPlayer('dev', 3000, 3000);
    world.runDevCommand('dev', 'spawn boss_demon 1');
    const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_demon')!;
    boss.x = 400;
    boss.y = 0;
    boss.facingX = -1;
    boss.facingY = 0;
    // 패턴 세 개를 전부 잠근다. 예전엔 이때 Attack01이 "평타"로 나왔다 — 같은 그림이
    // 평타와 1번 기술 양쪽으로 쓰이면서 서로를 덮어썼다.
    boss.meleeCooldowns.forEach((_, i) => {
      boss.meleeCooldowns[i] = 999;
    });

    world.addPlayer('p1', boss.x - 40, boss.y);
    const player = world.getPlayers().get('p1')!;

    for (let i = 0; i < 200; i += 1) {
      world.tick(0.01);
      expect(boss.pattern.kind).not.toBe('basicSwing');
    }
    expect(player.hp).toBe(100);
  });

  it('보스는 사람이 없으면 패턴으로 코어를 부순다 — 평타가 없어도 공격할 수 있다', () => {
    const world = new World();
    world.addPlayer('far', 3000, 3000); // 어그로 밖
    world.runDevCommand('far', 'spawn boss_demon 1');
    const boss = [...world.getMonsters().values()].find((m) => m.type === 'boss_demon')!;
    boss.x = 70;
    boss.y = 0;

    const coreBefore = world.getCore().hp;
    for (let i = 0; i < 400; i += 1) world.tick(0.05);

    expect(world.getCore().hp).toBeLessThan(coreBefore);
  });
});
