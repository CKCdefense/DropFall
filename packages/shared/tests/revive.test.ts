import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { reviveData, wavesData } from '../src/data';

/**
 * 쓰러뜨린다. 체력을 직접 0으로 쓰고 한 틱 굴리면 실제 피격과 같은 문(downPlayer)을
 * 지난다 — 몬스터를 불러 때리게 하는 것보다 짧고, 검증하려는 것(부활)과 무관한
 * 전투 규칙에 결과가 흔들리지 않는다.
 */
function knockDown(world: World, id: string): void {
  world.getPlayers().get(id)!.hp = 0;
  world.tick(0.001);
}

/** 구조 입력(E 누른 상태)을 실어 준다. 구조는 "누르고 있는 동안" 찬다. */
function holdInteract(world: World, id: string, seq = 1): void {
  world.setInput(id, { seq, moveX: 0, moveY: 0, aimAngle: 0, interact: true });
}

describe('부활 — 쓰러짐', () => {
  it('체력이 0이 되면 죽는 게 아니라 쓰러진다', () => {
    const world = new World();
    world.addPlayer('p1', 200, 200);
    knockDown(world, 'p1');

    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');
  });

  it('멀티에서는 30초가 지나면 유령이 된다', () => {
    const world = new World();
    world.addPlayer('p1', 200, 200);
    world.addPlayer('p2', 600, 600); // 혼자가 아니어야 전원 다운 패배로 안 끝난다
    knockDown(world, 'p1');

    world.tick(reviveData.ghostSeconds - 1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');

    world.tick(2);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');
  });

  it('혼자하기는 유령이 되지 않고 코어에서 부활한다', () => {
    const world = new World({ solo: true });
    world.addPlayer('p1', 400, 400);
    knockDown(world, 'p1');

    world.tick(reviveData.soloRespawnSeconds + 0.1);

    const player = world.getPlayers().get('p1')!;
    expect(player.lifeState).toBe('alive');
    expect(player.hp).toBeGreaterThan(0);
    // 쓰러진 자리가 아니라 코어 앞이다 — 자기를 눕힌 몬스터 한가운데서 일어나면
    // 그대로 다시 쓰러진다.
    expect(Math.hypot(player.x, player.y)).toBeLessThan(100);
  });

  it('혼자하기는 전원 다운이 패배가 아니다 — 기다리면 스스로 일어난다', () => {
    const world = new World({ solo: true });
    world.addPlayer('p1', 400, 400);
    knockDown(world, 'p1');

    world.tick(1);
    expect(world.getWavePhase()).not.toBe('defeat');
  });
});

describe('부활 — 동료 구조', () => {
  /** 구조 사거리 안에 살아있는 동료를 붙여 둔 상태로 시작한다. */
  function twoPlayers(): World {
    const world = new World();
    world.addPlayer('p1', 400, 400);
    world.addPlayer('p2', 400 + reviveData.rescueRadius / 2, 400);
    knockDown(world, 'p1');
    return world;
  }

  it('옆에서 상호작용을 누르고 있으면 5초 만에 그 자리에서 일어난다', () => {
    const world = twoPlayers();
    holdInteract(world, 'p2');

    world.tick(reviveData.rescueSeconds - 1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');

    world.tick(1.1);
    const player = world.getPlayers().get('p1')!;
    expect(player.lifeState).toBe('alive');
    expect(player.hp).toBe(Math.round(world.playerMaxHp(player) * reviveData.reviveHpRatio));
    // 그 자리다 — 코어로 끌려가지 않는다.
    expect(player.x).toBe(400);
  });

  it('누르지 않으면 아무리 옆에 있어도 차지 않는다', () => {
    const world = twoPlayers();
    world.setInput('p2', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0 });

    world.tick(reviveData.rescueSeconds + 1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');
  });

  it('멀면 차지 않는다', () => {
    const world = twoPlayers();
    world.getPlayers().get('p2')!.x = 400 + reviveData.rescueRadius * 3;
    holdInteract(world, 'p2');

    world.tick(reviveData.rescueSeconds + 1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');
  });

  it('놓으면 진행도가 같은 속도로 줄어든다 — 0으로 초기화되지는 않는다', () => {
    const world = twoPlayers();
    holdInteract(world, 'p2');
    world.tick(2);
    const peak = world.getPlayers().get('p1')!.reviveProgress;
    expect(peak).toBeGreaterThan(1.5);

    world.setInput('p2', { seq: 2, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(1);

    const progress = world.getPlayers().get('p1')!.reviveProgress;
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(peak);
  });

  it('쓰러진 사람은 다른 쓰러진 사람을 구조하지 못한다', () => {
    const world = twoPlayers();
    knockDown(world, 'p2');
    holdInteract(world, 'p2');

    world.tick(reviveData.rescueSeconds + 1);
    expect(world.getPlayers().get('p1')!.lifeState).not.toBe('alive');
  });

  it('유령이 된 뒤에는 구조로 일으킬 수 없다 — 코어에서 되살려야 한다', () => {
    const world = twoPlayers();
    world.tick(reviveData.ghostSeconds + 0.1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');

    holdInteract(world, 'p2');
    world.tick(reviveData.rescueSeconds + 1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');
  });
});

describe('부활 — AID', () => {
  /** p2에게 AID를 쥐여 주고, p1을 근접 사거리 안에 눕힌다. */
  function aidSetup(): World {
    const world = new World();
    world.addPlayer('p1', 412, 400);
    world.addPlayer('p2', 400, 400);
    const inventory = world.getPlayers().get('p2')!.inventory;
    // 지급품이 칸을 채우고 있으면 add()가 조용히 실패한다 — 첫 칸을 비우고 넣는다.
    inventory.takeAt(0);
    inventory.add('aid_kit', 1);
    world.selectSlot('p2', 0);
    // p1을 향해 조준한 상태(오른쪽)로 둔다 — 부채꼴 안에 들어와야 맞는다.
    world.setInput('p2', { seq: 1, moveX: 0, moveY: 0, aimAngle: 0 });
    world.tick(0.001);
    knockDown(world, 'p1');
    return world;
  }

  it('AID를 들고 쓰러진 아군을 때리면 즉시 일어난다', () => {
    const world = aidSetup();
    world.fireWeapon('p2');

    const player = world.getPlayers().get('p1')!;
    expect(player.lifeState).toBe('alive');
    expect(player.hp).toBeGreaterThan(0);
  });

  it('AID가 한 개 소모된다', () => {
    const world = aidSetup();
    world.fireWeapon('p2');

    expect(world.getPlayers().get('p2')!.inventory.countOf('aid_kit')).toBe(0);
  });

  it('AID가 아니면 아군을 때려도 일어나지 않는다', () => {
    const world = aidSetup();
    world.getPlayers().get('p2')!.inventory.takeAt(0); // AID를 뺀다 = 맨손
    world.fireWeapon('p2');

    expect(world.getPlayers().get('p1')!.lifeState).toBe('downed');
  });
});

describe('부활 — 코어에서 유령 되살리기', () => {
  /** p1은 코어 옆에 살아 있고, p2는 유령이다. 에너지는 충분히 채워 둔다. */
  function ghostAtCore(energy = reviveData.coreReviveEnergy): World {
    const world = new World();
    world.addPlayer('p1', 0, 55); // 코어(원점) 상호작용 거리 안 — 발자국 아래 27px + 여유 32px
    world.addPlayer('p2', 600, 600);
    knockDown(world, 'p2');
    world.tick(reviveData.ghostSeconds + 0.1);
    world.runDevCommand('p1', `energy ${energy}`);
    return world;
  }

  it('낮에 코어 옆에서 누르면 에너지를 치르고 되살아난다', () => {
    const world = ghostAtCore();
    expect(world.reviveGhostAtCore('p1', 'p2')).toBe(true);

    const target = world.getPlayers().get('p2')!;
    expect(target.lifeState).toBe('alive');
    expect(world.getCore().energy).toBe(0);
    // 코어 앞에서 다시 시작한다.
    expect(Math.hypot(target.x, target.y)).toBeLessThan(100);
  });

  it('에너지가 모자라면 아무 일도 일어나지 않는다', () => {
    const world = ghostAtCore(reviveData.coreReviveEnergy - 1);
    expect(world.reviveGhostAtCore('p1', 'p2')).toBe(false);
    expect(world.getPlayers().get('p2')!.lifeState).toBe('ghost');
  });

  it('코어에서 멀면 되살릴 수 없다', () => {
    const world = ghostAtCore();
    world.getPlayers().get('p1')!.x = 900;
    expect(world.reviveGhostAtCore('p1', 'p2')).toBe(false);
  });

  it('밤에는 되살릴 수 없다 — 전투 중 에너지가 곧 목숨이 되면 안 된다', () => {
    const world = ghostAtCore();
    world.tick(wavesData.dayDuration + 0.001);
    expect(world.getWavePhase()).toBe('night');

    expect(world.reviveGhostAtCore('p1', 'p2')).toBe(false);
    expect(world.getPlayers().get('p2')!.lifeState).toBe('ghost');
  });

  it('쓰러졌을 뿐인 사람은 코어 부활 대상이 아니다 — 구조로 일으켜야 한다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 55);
    world.addPlayer('p2', 600, 600);
    knockDown(world, 'p2');
    world.runDevCommand('p1', `energy ${reviveData.coreReviveEnergy}`);

    expect(world.reviveGhostAtCore('p1', 'p2')).toBe(false);
    expect(world.getCore().energy).toBe(reviveData.coreReviveEnergy);
  });
});

describe('부활 — 새 낮', () => {
  it('유령은 아침이 와도 스스로 돌아오지 못한다', () => {
    const world = new World();
    world.addPlayer('p1', 400, 400);
    world.addPlayer('p2', 600, 600);
    knockDown(world, 'p1');
    world.tick(reviveData.ghostSeconds + 0.1);
    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');

    // 밤을 한 바퀴 돌려 새 낮으로 넘긴다 — 아침의 자동 부활(revivePlayers)이 도는 시점이다.
    world.tick(wavesData.dayDuration + 0.001);
    for (let i = 0; i < 20000 && world.getWavePhase() === 'night'; i += 1) {
      world.tick(0.1);
      for (const id of [...world.getMonsters().keys()]) world.damageMonster(id, 0);
    }
    expect(world.getWavePhase()).toBe('day');

    expect(world.getPlayers().get('p1')!.lifeState).toBe('ghost');
  });
});
