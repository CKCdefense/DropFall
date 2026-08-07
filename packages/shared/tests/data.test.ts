import { describe, expect, it } from 'vitest';
import { monstersData, weaponsData, wavesData } from '../src/data';

describe('data', () => {
  it('monsters.json이 스키마를 통과하고 잡몹 6종 + 보스 4종을 포함한다', () => {
    expect(Object.keys(monstersData).sort()).toEqual([
      'blood',
      'boss_dark_knight',
      'boss_demon',
      'boss_golem',
      'boss_knight',
      'demon',
      'eyeball',
      'hellhound',
      'lava_slime',
      'minotaur',
    ]);
    // hellhound는 넓은 시야의 사냥꾼, blood는 사실상 코어 직행(몸에 닿아야 반응)이다.
    expect(monstersData.hellhound.aggroRadius).toBe(240);
    expect(monstersData.blood.aggroRadius).toBeLessThan(50);
    // 보스 4종은 전부 특수 패턴과 에너지 보상을 가진다 — 데이터 누락이 있으면 여기서
    // 잡힌다. 패턴 종류는 보스마다 다르다(검술 / 돌진·광역).
    for (const type of ['boss_demon', 'boss_knight', 'boss_golem', 'boss_dark_knight'] as const) {
      const data = monstersData[type];
      const hasPattern = !!(data.meleeAttacks ?? data.chargeAttack ?? data.slamAttack);
      expect(hasPattern, type).toBe(true);
      expect(data.energyDrop, type).toBeDefined();
    }

    // 2일차 보스는 스프라이트에 그려진 검술 3종을 쓴다. 사거리·각도는 프레임 실측에서
    // 나온 값이라, 누가 임의로 줄이면 "검이 닿아 보이는데 안 맞는다"가 된다.
    const demonMelee = monstersData.boss_demon.meleeAttacks!;
    expect(demonMelee).toHaveLength(3);
    expect(demonMelee.map((a) => a.anim)).toEqual([1, 2, 3]);
    const reach = (a: (typeof demonMelee)[number]) => Math.max(...a.hits.map((h) => h.range));
    // 양손 베기(3번)가 가장 멀고 가장 넓다.
    expect(reach(demonMelee[2]!)).toBeGreaterThan(reach(demonMelee[1]!));
    expect(demonMelee[2]!.hits[0]!.arc).toBeGreaterThan(demonMelee[0]!.hits[0]!.arc);
    // 찌르기(1번)는 멀지만 좁다 — 각도로 성격이 갈린다.
    expect(reach(demonMelee[0]!)).toBeGreaterThan(reach(demonMelee[1]!));
    expect(demonMelee[0]!.hits[0]!.arc).toBeLessThan(demonMelee[1]!.hits[0]!.arc);
    // 그림이 3배로 커진 만큼 피격 반경도 같이 커져야 한다(보이는 크기 = 맞는 범위).
    expect(monstersData.boss_demon.hitRadius).toBeGreaterThan(30);
  });

  it('weapons.json이 스키마를 통과하고 club/pistol을 포함한다', () => {
    expect(weaponsData.axe_t1.type).toBe('melee');
    expect(weaponsData.pistol.type).toBe('ranged');
    expect(weaponsData.pistol.projectileSpeed).toBe(420);
  });

  it('waves.json이 스키마를 통과하고 웨이브 5개를 포함한다', () => {
    expect(wavesData.waves).toHaveLength(5);
    expect(wavesData.coreHp).toBe(1000);
    // 1일차는 보스 없는 순수 디펜스, 2일차부터 매일 밤 다른 보스 레이드.
    expect(wavesData.waves[0]?.bossType).toBeUndefined();
    expect(wavesData.waves.slice(1).map((w) => w.bossType)).toEqual([
      'boss_demon',
      'boss_knight',
      'boss_golem',
      'boss_dark_knight',
    ]);
    // 웨이브의 모든 스폰/엘리트/보스 타입이 monsters.json에 실제로 존재해야 한다.
    for (const wave of wavesData.waves) {
      for (const type of Object.keys(wave.spawns)) expect(monstersData[type], type).toBeDefined();
      if (wave.elite) expect(monstersData[wave.elite.type], wave.elite.type).toBeDefined();
      if (wave.bossType) expect(monstersData[wave.bossType], wave.bossType).toBeDefined();
    }
    // 엘리트(미노타우르스)는 3일차부터만.
    expect(wavesData.waves[0]?.elite).toBeUndefined();
    expect(wavesData.waves[1]?.elite).toBeUndefined();
    expect(wavesData.waves[2]?.elite?.type).toBe('minotaur');
  });
});
