import { describe, expect, it } from 'vitest';
import { monstersData, weaponsData, wavesData } from '../src/data';

describe('data', () => {
  it('monsters.json이 스키마를 통과하고 4종을 포함한다', () => {
    expect(Object.keys(monstersData).sort()).toEqual(['boss', 'rusher', 'tanker', 'trash']);
    expect(monstersData.rusher.aggroRadius).toBe(120);
    expect(monstersData.tanker.aggroRadius).toBeUndefined();
  });

  it('weapons.json이 스키마를 통과하고 club/pistol을 포함한다', () => {
    expect(weaponsData.club.type).toBe('melee');
    expect(weaponsData.pistol.type).toBe('ranged');
    expect(weaponsData.pistol.projectileSpeed).toBe(420);
  });

  it('waves.json이 스키마를 통과하고 웨이브 5개를 포함한다', () => {
    expect(wavesData.waves).toHaveLength(5);
    expect(wavesData.coreHp).toBe(1000);
    expect(wavesData.waves[4]?.spawns.boss).toBe(1);
  });
});
