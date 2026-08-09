import { describe, expect, it } from 'vitest';
import { USE_FX, World } from '../src/sim/world';
import { itemsData, weaponsData } from '../src/data';
import { SLOT_COUNT } from '../src/sim/inventory';

/**
 * 무기·아이템 전면 재설계(2026-08)로 새로 생긴 규칙만 모았다 — 탄창/재장전, 산탄·관통·
 * 점사, 소모품 버프, 음식 영구 스탯, 채집 효율. 기존 판정(부채꼴·투사체 충돌)은
 * world-combat.test.ts가 계속 본다.
 */

/** 빈손 상태로 플레이어 하나를 세운 월드. 참가 지급 붕대까지 걷어 슬롯 번호를 고정한다. */
function worldWithPlayer(): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  const inventory = world.getPlayers().get('p1')!.inventory;
  for (let index = 0; index < SLOT_COUNT; index += 1) inventory.takeAt(index);
  return world;
}

/** 무기를 0번 칸에 쥐여주고 선택한다. */
function equip(world: World, itemId: string, count = 1): void {
  const inventory = world.getPlayers().get('p1')!.inventory;
  inventory.add(itemId, count);
  world.selectSlot('p1', inventory.toView().slots.findIndex((slot) => slot?.itemId === itemId));
}

/**
 * 몬스터에게 실컷 두들겨 맞힌다. 플레이어 피해는 전부 damagePlayer를 거치므로,
 * 진통제 같은 "피해 처리 규칙"은 실제 몬스터 공격으로 확인해야 의미가 있다.
 * 원점(플레이어 자리)에 한 마리 붙여 두고 공격 주기를 여러 번 넘긴다.
 */
function beatenByMonster(world: World): number {
  world.runDevCommand('p1', 'killall');
  world.runDevCommand('p1', 'spawn demon 1');
  for (const monster of world.getMonsters().values()) {
    monster.x = 2;
    monster.y = 0;
  }
  // 맞자마자 멈춘다 — 오래 두들기면 버프 지속시간(3초)을 넘겨 검증 자체가 무의미해진다.
  // 체력이 초당 조금씩 자연 회복하므로 "값이 달라졌나"가 아니라 "눈에 띄게 줄었나"로 본다.
  const player = world.getPlayers().get('p1')!;
  const before = player.hp;
  let lowest = player.hp;
  for (let i = 0; i < 40 && player.hp > before - 1; i += 1) {
    world.tick(0.05);
    lowest = Math.min(lowest, player.hp);
  }
  return lowest;
}

/**
 * 쿨다운을 확실히 넘기며 n발 쏜다. 쏘기 **전에** 시간을 흘린다 — 직전 발사 직후에
 * 바로 쏘면 쿨다운에 걸려 그 발이 조용히 사라진다(탄약도 안 준다).
 */
function fireTimes(world: World, count: number, gapSeconds = 1): void {
  for (let i = 0; i < count; i += 1) {
    world.tick(gapSeconds);
    world.fireWeapon('p1');
  }
}

describe('탄창과 재장전', () => {
  it('탄창이 있는 무기는 쏠 때마다 줄고, 다 쓰면 자동으로 재장전에 들어간다', () => {
    const world = worldWithPlayer();
    equip(world, 'revolver');
    const magazine = weaponsData.revolver.magazine!;

    world.fireWeapon('p1');
    expect(world.ammoView('p1')!.loaded).toBe(magazine - 1);

    fireTimes(world, magazine - 1);
    expect(world.ammoView('p1')!.loaded).toBe(0);
    expect(world.ammoView('p1')!.reloadRemaining).toBeGreaterThan(0);
  });

  it('재장전 중에는 발사되지 않고, 끝나면 탄창이 가득 찬다', () => {
    const world = worldWithPlayer();
    equip(world, 'revolver');
    fireTimes(world, weaponsData.revolver.magazine!);
    expect(world.ammoView('p1')!.loaded).toBe(0);

    const before = world.getProjectiles().size;
    world.fireWeapon('p1');
    expect(world.getProjectiles().size).toBe(before);

    world.tick(weaponsData.revolver.reloadTime!);
    expect(world.ammoView('p1')!.loaded).toBe(weaponsData.revolver.magazine);
  });

  it('수동 재장전(R)은 탄을 쓴 뒤에만 의미가 있다', () => {
    const world = worldWithPlayer();
    equip(world, 'handgun');

    world.reloadWeapon('p1'); // 가득이라 아무 일도 없다
    expect(world.ammoView('p1')!.reloadRemaining).toBe(0);

    world.fireWeapon('p1');
    world.reloadWeapon('p1');
    expect(world.ammoView('p1')!.reloadRemaining).toBeGreaterThan(0);
  });

  it('탄창은 무기별로 따로 센다 — 바꿔 들었다 돌아와도 쓴 만큼 그대로다', () => {
    const world = worldWithPlayer();
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('handgun', 1);
    inventory.add('revolver', 1);

    world.selectSlot('p1', 0);
    world.fireWeapon('p1');
    const handgunLeft = world.ammoView('p1')!.loaded;

    world.selectSlot('p1', 1);
    expect(world.ammoView('p1')!.loaded).toBe(weaponsData.revolver.magazine);

    world.selectSlot('p1', 0);
    expect(world.ammoView('p1')!.loaded).toBe(handgunLeft);
  });

  it('근접 무기는 탄약 개념이 없어 무한히 휘두를 수 있다', () => {
    const world = worldWithPlayer();
    equip(world, 'bat');

    expect(world.ammoView('p1')).toBeNull();
    expect(() => fireTimes(world, 20)).not.toThrow();
  });
});

describe('원거리 특수 능력', () => {
  it('산탄총은 한 번 쏘면 펠릿 수만큼 투사체가 나간다', () => {
    const world = worldWithPlayer();
    equip(world, 'pump_shotgun');

    world.fireWeapon('p1');

    expect(world.getProjectiles().size).toBe(weaponsData.pump_shotgun.pellets);
  });

  it('관통탄은 첫 몬스터를 맞혀도 사라지지 않고 뒤의 몬스터까지 뚫는다', () => {
    const world = worldWithPlayer();
    equip(world, 'sniper_rifle');
    for (const node of world.getResourceNodes().values()) {
      node.x = 5000;
      node.y = 5000;
    }

    // 코어(반경 40) 밖에서 쏜다 — 원점에서 쏘면 총구가 코어 안이라 투사체가 흡수된다.
    const player = world.getPlayers().get('p1')!;
    player.x = 300;
    player.y = 0;

    // 조준선(+x) 위에 두 마리를 세운다. 관통이 아니면 뒤쪽은 절대 맞지 않는다.
    world.runDevCommand('p1', 'spawn demon 2');
    const monsters = [...world.getMonsters().values()];
    monsters[0]!.x = 420;
    monsters[0]!.y = 0;
    monsters[0]!.hp = 1;
    monsters[1]!.x = 500;
    monsters[1]!.y = 0;
    monsters[1]!.hp = 1;

    world.fireWeapon('p1');
    for (let i = 0; i < 60 && world.getMonsters().size > 0; i += 1) world.tick(1 / 60);

    expect(world.getMonsters().size).toBe(0);
  });

  it('관통 횟수가 정해진 무기는 그 수만큼만 뚫고, 그다음 몬스터는 못 맞힌다', () => {
    // docs/backend/68 — pierceCount는 "첫 타격 포함 몇 마리까지"가 아니라 "첫 타격 이후
    // 몇 마리를 더 뚫는지"다. crossbow는 pierceCount:2라 총 3마리(첫 타격+2관통)까지만
    // 맞아야 하고, 줄 세운 4번째는 맞지 않아야 한다.
    const world = worldWithPlayer();
    expect(weaponsData.crossbow.pierceCount).toBe(2);
    equip(world, 'crossbow');
    for (const node of world.getResourceNodes().values()) {
      node.x = 5000;
      node.y = 5000;
    }

    const player = world.getPlayers().get('p1')!;
    player.x = 300;
    player.y = 0;

    // 조준선(+x) 위에 넉넉히 간격을 두고 4마리를 세운다. 총구 간격(muzzleOffset=42,
    // 즉 x=300~342 사이)에 몬스터가 있으면 투사체를 만들지도 않고 그 자리에서 바로
    // 맞힌 것으로 처리해버려(§resolveMuzzleGapHit, 관통과 무관한 별개 경로) 이
    // 테스트가 보려는 "관통" 자체를 안 타게 된다 — 그래서 첫 몬스터도 총구 간격
    // 밖(400)에 세운다.
    world.runDevCommand('p1', 'spawn demon 4');
    const monsters = [...world.getMonsters().values()];
    for (let i = 0; i < monsters.length; i += 1) {
      monsters[i]!.x = 400 + i * 40;
      monsters[i]!.y = 0;
      monsters[i]!.hp = 1;
    }
    const survivorId = monsters[3]!.id; // 줄 맨 끝(가장 먼) 몬스터

    world.fireWeapon('p1');
    for (let i = 0; i < 60 && world.getProjectiles().size > 0; i += 1) world.tick(1 / 60);

    const alive = [...world.getMonsters().values()];
    expect(alive.length).toBe(1); // 4마리 중 1마리(줄 맨 끝)만 살아남는다
    // 몬스터가 그사이 플레이어 쪽으로 걸어와 좌표는 안 맞을 수 있으니(demon speed=45),
    // 위치가 아니라 살아남은 개체의 id로 "정확히 4번째"인지 확인한다.
    expect(alive[0]!.id).toBe(survivorId);
  });

  it('점사 모드는 방아쇠 한 번에 여러 발이 나가고, 지원하지 않는 무기에서는 켜지지 않는다', () => {
    const world = worldWithPlayer();
    equip(world, 'assault_rifle');

    world.toggleFireMode('p1');
    expect(world.getPlayers().get('p1')!.burstMode).toBe(true);

    world.fireWeapon('p1');
    expect(world.getProjectiles().size).toBe(1); // 첫 발은 즉시
    const burst = weaponsData.assault_rifle.burst!;
    for (let i = 0; i < burst.count; i += 1) world.tick(burst.interval);
    expect(world.getProjectiles().size).toBe(burst.count);

    // 점사가 없는 무기로 바꾸면 토글 자체가 먹히지 않는다.
    const inventory = world.getPlayers().get('p1')!.inventory;
    inventory.add('handgun', 1);
    world.selectSlot('p1', 1);
    world.getPlayers().get('p1')!.burstMode = false;
    world.toggleFireMode('p1');
    expect(world.getPlayers().get('p1')!.burstMode).toBe(false);
  });

  it('무기마다 사거리가 다르다 — 저격탄은 산탄보다 훨씬 멀리 간다', () => {
    const world = worldWithPlayer();
    equip(world, 'double_barrel_shotgun');
    world.fireWeapon('p1');
    const shotgunRange = [...world.getProjectiles().values()][0]!.remainingRange;

    const sniperWorld = worldWithPlayer();
    equip(sniperWorld, 'sniper_rifle');
    sniperWorld.fireWeapon('p1');
    const sniperRange = [...sniperWorld.getProjectiles().values()][0]!.remainingRange;

    expect(sniperRange).toBeGreaterThan(shotgunRange * 3);
  });
});

describe('소모품 — 치료와 버프', () => {
  it('붕대는 최대 체력의 비율만큼 회복한다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    player.hp = 10;
    equip(world, 'bandage');

    world.useSelectedItem('p1');

    const expected = 10 + Math.round(world.playerMaxHp(player) * itemsData.bandage.healPercent!);
    expect(player.hp).toBe(expected);
  });

  it('AID는 체력을 전부 채운다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    player.hp = 1;
    equip(world, 'aid_kit');

    world.useSelectedItem('p1');

    expect(player.hp).toBe(world.playerMaxHp(player));
  });

  it('진통제를 쓰면 지속시간 동안 체력이 1 아래로 떨어지지 않는다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'painkiller');

    world.useSelectedItem('p1');
    expect(player.hpFloorTimer).toBeCloseTo(itemsData.painkiller.hpFloorSeconds!, 5);

    // 몬스터에게 맞아도 1 아래로는 안 내려간다 — 몬스터 공격이 damagePlayer를 거치는
    // 유일한 경로라, 규칙이 실제로 도는지 보려면 진짜로 맞아야 한다.
    world.runDevCommand('p1', 'hp 5');
    expect(beatenByMonster(world)).toBe(1);

    // 시간이 지나면 보호가 풀리고 같은 공격에 쓰러진다.
    world.tick(itemsData.painkiller.hpFloorSeconds!);
    expect(player.hpFloorTimer).toBeLessThanOrEqual(0);
    // 보호가 없으면 같은 공격에 1 아래로 내려간다(자연 회복분 때문에 정확히 0은 아니다).
    world.runDevCommand('p1', 'hp 5');
    expect(beatenByMonster(world)).toBeLessThan(1);
  });

  it('아드레날린은 지속시간 동안 이동속도를 올린다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'adrenaline');

    expect(world.playerSpeedMultiplier(player)).toBe(1);
    world.useSelectedItem('p1');
    expect(world.playerSpeedMultiplier(player)).toBe(itemsData.adrenaline.speedMultiplier);

    world.tick(itemsData.adrenaline.speedSeconds!);
    expect(world.playerSpeedMultiplier(player)).toBe(1);
  });

  it('체력이 가득이어도 버프 아이템은 쓸 수 있다(붕대와 달리 낭비가 아니다)', () => {
    const world = worldWithPlayer();
    equip(world, 'adrenaline');

    world.useSelectedItem('p1');

    expect(world.getPlayers().get('p1')!.inventory.countOf('adrenaline')).toBe(0);
  });
});

describe('음식 — 영구 스탯', () => {
  it('도넛은 최대 체력을 올리고, 늘어난 만큼 현재 체력도 같이 찬다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    const before = world.playerMaxHp(player);
    const beforeHp = player.hp;
    equip(world, 'donut');

    world.useSelectedItem('p1');

    const bonus = itemsData.donut.statBonus!.amount;
    expect(world.playerMaxHp(player)).toBe(before + bonus);
    expect(player.hp).toBe(beforeHp + bonus);
  });

  it('너겟은 공격력 스탯을 올리고, 무기 데미지엔 fireRate로 나눈 만큼만 더해진다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    const attackBefore = world.playerAttack(player);
    equip(world, 'nuggets');
    world.useSelectedItem('p1');

    expect(world.playerAttack(player)).toBe(attackBefore + itemsData.nuggets.statBonus!.amount);

    equip(world, 'handgun');
    world.fireWeapon('p1');

    // 공격력 스탯은 "초당 보너스"가 고정이지 "한 발당 보너스"가 고정이 아니다 —
    // fireRate로 나눠서 실은 만큼만 한 발에 붙는다(연사 무기가 스탯을 몇 배로
    // 챙기지 않게 하는 장치, 데모 준비도 리뷰 피드백 #1).
    const projectile = [...world.getProjectiles().values()][0]!;
    expect(projectile.damage).toBeCloseTo(
      weaponsData.handgun.damage + world.playerAttack(player) / weaponsData.handgun.fireRate,
      5,
    );
  });

  it('같은 공격력 스탯이면 무기 fireRate와 무관하게 초당 딜량 기여가 같다', () => {
    // 회귀 방지용 — #1 피드백의 핵심 버그(빠른 무기일수록 스탯 보너스가 몇 배로
    // 뻥튀기됨)가 재발하면 이 테스트가 깨진다. 실제로 두 무기를 쏴서 결과 투사체
    // 데미지로 검증한다(공식을 다시 베껴 계산하면 버그가 그대로 통과해버린다).
    const slow = weaponsData.sniper_rifle;
    const fast = weaponsData.minigun;
    expect(slow.fireRate).toBeLessThan(fast.fireRate);

    function fireOnceWithNuggets(weaponId: string) {
      const world = worldWithPlayer();
      equip(world, 'nuggets', 10);
      for (let i = 0; i < 10; i += 1) world.useSelectedItem('p1');
      equip(world, weaponId);
      world.fireWeapon('p1');
      return [...world.getProjectiles().values()][0]!.damage;
    }

    const slowDamage = fireOnceWithNuggets('sniper_rifle');
    const fastDamage = fireOnceWithNuggets('minigun');

    const slowBonusPerShot = slowDamage - slow.damage;
    const fastBonusPerShot = fastDamage - fast.damage;
    expect(slowBonusPerShot).toBeGreaterThan(0);
    // 한 발당 보너스는 다르지만(느린 무기가 더 큼), 초당 보너스(보너스×fireRate)는 같다.
    expect(slowBonusPerShot * slow.fireRate).toBeCloseTo(fastBonusPerShot * fast.fireRate, 5);
  });

  it('초콜릿은 이동속도를 영구히 올린다(아드레날린과 곱해진다)', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'chocolate');
    world.useSelectedItem('p1');

    const staminaBonus = itemsData.chocolate.statBonus!.amount;
    expect(world.playerSpeedMultiplier(player)).toBeCloseTo(1 + staminaBonus, 5);

    equip(world, 'adrenaline');
    world.useSelectedItem('p1');
    expect(world.playerSpeedMultiplier(player)).toBeCloseTo(
      (1 + staminaBonus) * itemsData.adrenaline.speedMultiplier!,
      5,
    );
  });

  it('음식 효과는 밤을 넘겨 부활해도 유지된다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'carrot_cake');
    world.useSelectedItem('p1');

    const maxHp = world.playerMaxHp(player);
    player.hp = 1;
    world.runDevCommand('p1', 'heal');

    expect(player.hp).toBe(maxHp);
  });
});

describe('소모품 사용 이펙트 신호', () => {
  it('종류별로 다른 이펙트를 지목한다 — 치료/버프/음식', () => {
    const cases: [string, number][] = [
      ['bandage', USE_FX.heal],
      ['adrenaline', USE_FX.buff],
      ['painkiller', USE_FX.buff],
      ['donut', USE_FX.statup],
    ];

    for (const [itemId, kind] of cases) {
      const world = worldWithPlayer();
      const player = world.getPlayers().get('p1')!;
      player.hp = 1; // 붕대가 낭비로 판정돼 소모되지 않는 일을 막는다
      equip(world, itemId);

      world.useSelectedItem('p1');

      expect(player.useFxKind).toBe(kind);
      expect(player.useFxSeq).toBe(1);
    }
  });

  it('음식은 체력도 같이 차지만 이펙트는 스탯 상승이다', () => {
    // 도넛은 최대 체력을 올리며 그만큼 체력도 채운다. 회복으로 분류하면 "스탯이 올랐다"가
    // 화면에서 사라진다 — 먹은 이유가 그것인데.
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    player.hp = 1;
    equip(world, 'donut');

    world.useSelectedItem('p1');

    expect(player.hp).toBeGreaterThan(1);
    expect(player.useFxKind).toBe(USE_FX.statup);
  });

  it('쓸 때마다 번호가 오른다 — 같은 아이템을 연달아 써도 이펙트가 다시 난다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'adrenaline', 3);

    world.useSelectedItem('p1');
    world.useSelectedItem('p1');

    expect(player.useFxSeq).toBe(2);
  });

  it('효과가 없어 소모되지 않으면 번호도 그대로다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    equip(world, 'bandage');

    // 체력이 가득이라 붕대는 소모되지 않는다.
    world.useSelectedItem('p1');

    expect(player.useFxSeq).toBe(0);
    expect(player.inventory.countOf('bandage')).toBe(1);
  });
});

describe('채집 효율', () => {
  it('효율 좋은 도구(토마호크)는 같은 데미지 대비 나무를 더 빨리 캔다', () => {
    const tomahawk = weaponsData.tomahauk;
    const fireAxe = weaponsData.fire_axe;

    // 채집 효율은 전투 데미지와 분리된 축이다 — 데미지가 아니라 배수가 다르다.
    expect(tomahawk.gatherMultiplier!).toBeGreaterThan(fireAxe.gatherMultiplier!);
  });

  it('나무를 못 캐는 무기(나이프)는 도구 계열이 없어 노드에 아무 영향이 없다', () => {
    expect(weaponsData.knife.toolFamily).toBeUndefined();
    expect(weaponsData.machete.toolFamily).toBe('axe');
  });
});
