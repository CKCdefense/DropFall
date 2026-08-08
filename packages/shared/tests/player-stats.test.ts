import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { jobsData, jobStats, weaponsData } from '../src/data';
import { SLOT_COUNT } from '../src/sim/inventory';

/**
 * 캐릭터 기초 스탯 — 공격력·스태미나·체력. 직업이 시작 수치를 정하고, 스탯은 전투와
 * 이동에 실제로 영향을 준다(수치만 있고 아무 데도 안 쓰이면 스탯이 아니다).
 */

function worldWithPlayer(job = ''): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  if (job) world.setPlayerJob('p1', job);
  const inventory = world.getPlayers().get('p1')!.inventory;
  for (let i = 0; i < SLOT_COUNT; i += 1) inventory.takeAt(i);
  return world;
}

/** 이동 입력을 넣는다. 스태미나는 "실제로 달릴 때"만 타므로 움직임이 필요하다. */
function move(world: World, seq: number, sprint: boolean, moving = true): void {
  world.setInput('p1', { seq, moveX: moving ? 1 : 0, moveY: 0, aimAngle: 0, sprint });
}

describe('직업별 기초 스탯', () => {
  it('네 직업이 서로 다른 시작 수치를 갖는다', () => {
    const jobs = ['soldier', 'searchman', 'medic', 'engineer'] as const;
    const hp = jobs.map((job) => jobStats(job).maxHp);
    const attack = jobs.map((job) => jobStats(job).attack);
    const stamina = jobs.map((job) => jobStats(job).maxStamina);

    // 전부 같으면 직업을 고를 이유가 없다 — 축마다 최소한 서로 다른 값이 있어야 한다.
    expect(new Set(hp).size).toBeGreaterThan(1);
    expect(new Set(attack).size).toBeGreaterThan(1);
    expect(new Set(stamina).size).toBeGreaterThan(1);
  });

  it('병사는 화력·맷집이 가장 높고, 탐색꾼은 가장 오래 달린다', () => {
    for (const job of ['searchman', 'medic', 'engineer'] as const) {
      expect(jobsData.soldier.attack).toBeGreaterThan(jobStats(job).attack);
      expect(jobsData.soldier.maxHp).toBeGreaterThanOrEqual(jobStats(job).maxHp);
    }
    for (const job of ['soldier', 'medic', 'engineer'] as const) {
      expect(jobsData.searchman.maxStamina).toBeGreaterThan(jobStats(job).maxStamina);
    }
  });

  it('직업을 정하면 체력·스태미나가 그 직업 수치로 가득 찬다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    expect(world.playerMaxHp(player)).toBe(jobsData.base.maxHp);

    world.setPlayerJob('p1', 'soldier');

    expect(world.playerMaxHp(player)).toBe(jobsData.soldier.maxHp);
    expect(player.hp).toBe(jobsData.soldier.maxHp);
    expect(player.stamina).toBe(jobsData.soldier.maxStamina);
  });

  it('모르는 직업이면 기준값으로 되돌아간다(빈 문자열 포함)', () => {
    expect(jobStats('')).toEqual(jobsData.base);
    expect(jobStats('없는직업')).toEqual(jobsData.base);
  });
});

describe('공격력 스탯', () => {
  it('무기 데미지에 그대로 더해진다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;
    player.inventory.add('handgun', 1);

    world.fireWeapon('p1');

    const projectile = [...world.getProjectiles().values()][0]!;
    expect(projectile.damage).toBeCloseTo(weaponsData.handgun.damage + jobsData.soldier.attack, 5);
  });

  it('산탄은 펠릿마다 더하지 않는다 — 한 발의 총 위력 기준으로 나눠 싣는다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;
    player.inventory.add('pump_shotgun', 1);

    world.fireWeapon('p1');

    const pellets = [...world.getProjectiles().values()];
    const total = pellets.reduce((sum, pellet) => sum + pellet.damage, 0);
    const weapon = weaponsData.pump_shotgun;
    expect(total).toBeCloseTo(weapon.damage * weapon.pellets! + jobsData.soldier.attack, 5);
  });

  it('공격력이 높은 직업이 같은 무기로 더 아프게 때린다', () => {
    const strong = worldWithPlayer('soldier');
    strong.getPlayers().get('p1')!.inventory.add('handgun', 1);
    strong.fireWeapon('p1');

    const weak = worldWithPlayer('medic');
    weak.getPlayers().get('p1')!.inventory.add('handgun', 1);
    weak.fireWeapon('p1');

    expect([...strong.getProjectiles().values()][0]!.damage).toBeGreaterThan(
      [...weak.getProjectiles().values()][0]!.damage,
    );
  });
});

describe('스태미나와 달리기', () => {
  it('달리면 줄고 걸으면 다시 찬다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;

    move(world, 1, true);
    world.tick(1);
    const afterRun = player.stamina;
    expect(afterRun).toBeLessThan(jobsData.soldier.maxStamina);

    // 걷기로 바꾸면 회복 지연이 지난 뒤부터 다시 찬다.
    move(world, 2, false);
    world.tick(3);
    expect(player.stamina).toBeGreaterThan(afterRun);
  });

  it('달리는 동안에만 빨라진다 — 스태미나가 바닥나면 걷는 속도로 돌아온다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;

    move(world, 1, true);
    world.tick(0.1);
    expect(world.playerSpeedMultiplier(player)).toBeGreaterThan(1);

    // 다 태울 때까지 계속 달린다.
    for (let i = 0; i < 200 && player.stamina > 0; i += 1) {
      move(world, i + 2, true);
      world.tick(0.05);
    }

    expect(player.stamina).toBe(0);
    expect(world.playerSpeedMultiplier(player)).toBe(1);
  });

  it('제자리에서 누르고만 있으면 닳지 않는다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;

    move(world, 1, true, false); // 달리기 키만 누른 채 멈춰 있다
    world.tick(2);

    expect(player.stamina).toBe(jobsData.soldier.maxStamina);
  });

  it('실제로 더 멀리 간다 — 배율이 이동에 반영된다', () => {
    const running = worldWithPlayer('soldier');
    move(running, 1, true);
    running.tick(1);

    const walking = worldWithPlayer('soldier');
    move(walking, 1, false);
    walking.tick(1);

    expect(running.getPlayers().get('p1')!.x).toBeGreaterThan(
      walking.getPlayers().get('p1')!.x,
    );
  });
});

describe('체력 자연 회복', () => {
  it('아주 느리게 찬다 — 2초에 1 정도', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;
    player.hp = 10;

    world.tick(2);

    expect(player.hp).toBeGreaterThan(10);
    expect(player.hp).toBeLessThanOrEqual(11.5);
  });

  it('최대치를 넘기지 않는다', () => {
    const world = worldWithPlayer('soldier');
    const player = world.getPlayers().get('p1')!;
    player.hp = world.playerMaxHp(player) - 2;

    // 낮 안에서 끝낸다 — 밤이 오면 몬스터가 때려서 회복만 보는 시험이 되지 않는다.
    for (let i = 0; i < 100; i += 1) world.tick(0.2);

    expect(player.hp).toBe(world.playerMaxHp(player));
  });

  it('쓰러진 사람은 저절로 일어나지 않는다 — 부활은 동료 몫이다', () => {
    const world = worldWithPlayer('soldier');
    world.addPlayer('p2', 50, 0); // 전원 다운이 아니어야 패배로 끝나지 않는다
    const player = world.getPlayers().get('p1')!;
    player.hp = 0;

    for (let i = 0; i < 100; i += 1) world.tick(1);

    expect(player.hp).toBe(0);
  });
});
