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
    // 보스 4종은 전부 특수 패턴 두 개를 가진다 — 데이터 누락이 있으면 여기서 잡힌다.
    for (const type of ['boss_demon', 'boss_knight', 'boss_golem', 'boss_dark_knight'] as const) {
      expect(monstersData[type].chargeAttack, type).toBeDefined();
      expect(monstersData[type].slamAttack, type).toBeDefined();
      expect(monstersData[type].energyDrop, type).toBeDefined();
    }
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
