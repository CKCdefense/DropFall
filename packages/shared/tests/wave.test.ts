import { describe, expect, it } from 'vitest';
import { WaveManager } from '../src/sim/wave';
import { wavesData, type WaveEntry } from '../src/data';

/** 매번 같은 시퀀스를 내는 결정론적 rng — 테스트 재현성용. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** 엘리트 굴림 제외 기본 스폰 총원. 엘리트는 확률이라 정확 수치 검증에서 뺀다. */
function baseTotal(entry: WaveEntry): number {
  return Object.values(entry.spawns).reduce((a, b) => a + b, 0);
}

/** 엘리트가 전부 성공했을 때의 상한. 실제 스폰 수는 [base, max] 안에 있어야 한다. */
function maxTotal(entry: WaveEntry): number {
  return baseTotal(entry) + (entry.elite?.count ?? 0);
}

/**
 * 진행 중인 밤의 잡몹 스폰 큐를 전부 소진시킨다(보스는 전멸 전이라 아직 안 나온다).
 * 스폰된 몬스터는 계속 살아있는 것으로 계산한다 — 밤이 끝나지 않게.
 */
function drainMinionSpawns(
  manager: WaveManager,
  entry: WaveEntry,
  onSpawn: (type: string, x: number, y: number) => void,
): number {
  let alive = 0;
  for (let i = 0; i < 5000 && alive < maxTotal(entry); i += 1) {
    manager.tick(
      entry.groupIntervalSeconds / 4,
      () => alive,
      (type, x, y) => {
        alive += 1;
        onSpawn(type, x, y);
      },
    );
    // 큐가 다 비었는지는 밖에서 알 수 없으니, base 이상 스폰된 뒤 한 사이클을 더 돌려
    // 엘리트 성공분까지 회수한다. 상한 도달이면 즉시 끝.
    if (alive >= baseTotal(entry) && i > 60) break;
  }
  return alive;
}

describe('WaveManager', () => {
  it('처음엔 day 페이즈로 시작하고 dayDuration만큼 카운트다운한다', () => {
    const manager = new WaveManager({ rng: seededRng(1) });
    expect(manager.currentPhase).toBe('day');
    expect(manager.currentWave).toBe(0);
    expect(manager.phaseTimeRemaining).toBe(wavesData.dayDuration);
  });

  it('day 타이머가 끝나면 1웨이브(night)로 전환하고 첫 무리를 즉시 스폰한다', () => {
    const manager = new WaveManager({ rng: seededRng(1) });
    const spawned: { type: string; x: number; y: number }[] = [];

    // day → night 전환은 한 틱에서 일어나고, 실제 스폰은 그다음 틱부터 시작된다.
    manager.tick(wavesData.dayDuration, () => 0, (type, x, y) => spawned.push({ type, x, y }));
    expect(manager.currentPhase).toBe('night');
    expect(manager.currentWave).toBe(1);

    manager.tick(0.001, () => 0, (type, x, y) => spawned.push({ type, x, y }));
    // 무리 스폰: 한 마리씩이 아니라 groupSize마리가 같은 틱에 함께 나온다.
    expect(spawned.length).toBe(Math.min(wavesData.waves[0]!.groupSize, baseTotal(wavesData.waves[0]!)));
  });

  it('한 무리는 같은 스폰 지점에서 함께 나오고, 다음 무리는 groupIntervalSeconds 뒤에 나온다', () => {
    const manager = new WaveManager({ rng: seededRng(42) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night

    const wave1 = wavesData.waves[0]!;
    const first: { x: number; y: number }[] = [];
    manager.tick(0.001, () => 0, (_type, x, y) => first.push({ x, y }));
    expect(first.length).toBe(wave1.groupSize);
    // 같은 무리 = 같은 지점.
    expect(new Set(first.map((p) => `${p.x},${p.y}`)).size).toBe(1);

    // 간격이 되기 전에는 다음 무리가 안 나온다.
    const early: string[] = [];
    manager.tick(wave1.groupIntervalSeconds * 0.5, () => first.length, (type) => early.push(type));
    expect(early.length).toBe(0);

    // 간격을 채우면 다음 무리가 나온다.
    const second: string[] = [];
    manager.tick(wave1.groupIntervalSeconds * 0.6, () => first.length, (type) => second.push(type));
    expect(second.length).toBe(wave1.groupSize);
  });

  it('1웨이브 전체 몬스터가 스폰될 때까지 계속 틱하면 기본 총원이 전부 스폰된다', () => {
    const manager = new WaveManager({ rng: seededRng(42) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night 전환

    const wave1 = wavesData.waves[0]!;
    const spawned: string[] = [];
    const alive = drainMinionSpawns(manager, wave1, (type) => spawned.push(type));

    // 1웨이브는 엘리트가 없어 정확히 기본 총원이다.
    expect(wave1.elite).toBeUndefined();
    expect(alive).toBe(baseTotal(wave1));
    expect(spawned).toContain('demon');
    expect(spawned).toContain('hellhound');
  });

  it('보스 없는 웨이브(1일차)는 스폰이 끝나고 전멸하면 바로 다음 낮으로 넘어간다', () => {
    const manager = new WaveManager({ rng: seededRng(7) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night, wave 1

    const wave1 = wavesData.waves[0]!;
    expect(wave1.bossType).toBeUndefined();
    const alive = drainMinionSpawns(manager, wave1, () => {});
    expect(alive).toBe(baseTotal(wave1));

    // 스폰 큐는 비었지만 아직 몬스터가 안 죽은 상태 — 밤이 계속돼야 한다
    manager.tick(0.1, () => alive, () => {});
    expect(manager.currentPhase).toBe('night');

    // 전부 처치되면 보스 없이 바로 낮으로 전환
    manager.tick(0.1, () => 0, () => {
      throw new Error('1일차에는 보스가 나오면 안 된다');
    });
    expect(manager.currentPhase).toBe('day');
    expect(manager.currentWave).toBe(1); // 아직 2웨이브 시작 전
  });

  it('보스 웨이브(2일차~)는 잡몹 전멸 후 보스가 나오고, 보스를 잡아야 낮이 온다', () => {
    const manager = new WaveManager({ rng: seededRng(7) });
    manager.debugJumpToWave(2);

    const wave2 = wavesData.waves[1]!;
    expect(wave2.bossType).toBe('boss_demon');
    const alive = drainMinionSpawns(manager, wave2, (type) => {
      expect(type).not.toBe('boss_demon'); // 잡몹 페이즈에는 보스가 섞여 나오면 안 된다
    });

    // 잡몹 전멸 → 이 틱에 보스가 소환된다(낮이 아니라).
    const bossSpawns: string[] = [];
    manager.tick(0.1, () => 0, (type) => bossSpawns.push(type));
    expect(bossSpawns).toEqual(['boss_demon']);
    expect(manager.currentPhase).toBe('night');
    expect(alive).toBeGreaterThanOrEqual(baseTotal(wave2));

    // 보스가 살아있는 동안은 계속 밤이다.
    manager.tick(0.1, () => 1, () => {});
    expect(manager.currentPhase).toBe('night');

    // 보스 처치 → 낮.
    manager.tick(0.1, () => 0, () => {});
    expect(manager.currentPhase).toBe('day');
  });

  it('마지막 웨이브의 보스까지 잡으면 victory가 된다', () => {
    const manager = new WaveManager({ rng: seededRng(3) });

    for (let waveNum = 0; waveNum < wavesData.waves.length; waveNum += 1) {
      manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night
      const entry = wavesData.waves[waveNum]!;
      drainMinionSpawns(manager, entry, () => {});

      if (entry.bossType) {
        const bossSpawns: string[] = [];
        manager.tick(0.1, () => 0, (type) => bossSpawns.push(type)); // 전멸 → 보스 소환
        expect(bossSpawns).toEqual([entry.bossType]);
      }
      manager.tick(0.1, () => 0, () => {}); // 보스(또는 잡몹) 전멸 → 다음 페이즈
    }

    expect(manager.currentPhase).toBe('victory');
  });

  it('스폰 지점을 무리 단위로 순환해서 한 지점에 몰리지 않는다', () => {
    const manager = new WaveManager({ rng: seededRng(5) });
    manager.debugJumpToWave(2); // wave 2: 스폰 지점 2곳

    const wave2 = wavesData.waves[1]!;
    const points: { x: number; y: number }[] = [];
    drainMinionSpawns(manager, wave2, (_type, x, y) => points.push({ x, y }));

    const unique = new Map<string, number>();
    for (const p of points) {
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      unique.set(key, (unique.get(key) ?? 0) + 1);
    }

    // 무리가 지점을 번갈아 썼다면 두 지점의 스폰 수 차이가 무리 하나 이하여야 한다.
    expect(unique.size).toBe(wave2.spawnPoints);
    const counts = [...unique.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(wave2.groupSize);
  });

  it('skipDay는 day 페이즈에서만 즉시 night으로 전환시킨다', () => {
    const manager = new WaveManager({ rng: seededRng(11) });
    expect(manager.currentPhase).toBe('day');

    manager.skipDay();

    expect(manager.currentPhase).toBe('night');
    expect(manager.currentWave).toBe(1);
  });

  it('night 페이즈에서 skipDay를 호출해도 아무 일도 일어나지 않는다', () => {
    const manager = new WaveManager({ rng: seededRng(11) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night
    expect(manager.currentPhase).toBe('night');

    manager.skipDay();

    expect(manager.currentPhase).toBe('night');
    expect(manager.currentWave).toBe(1);
  });

  it('markDefeat 호출 후에는 더 이상 진행하지 않는다', () => {
    const manager = new WaveManager({ rng: seededRng(9) });
    manager.markDefeat();
    expect(manager.currentPhase).toBe('defeat');

    manager.tick(9999, () => 0, () => {
      throw new Error('defeat 이후에는 spawn이 호출되면 안 된다');
    });
    expect(manager.currentPhase).toBe('defeat');
  });

  it('스폰 큐가 이번 틱에 비워지는 순간 새로 스폰된 몬스터를 산 것으로 계산한다(같은 틱 경합 방지)', () => {
    // backend/22에서 고친 버그의 회귀 테스트: remainingMonsters를 틱 시작 시점 값으로
    // "스냅샷"해서 넘기면, 그 틱 안에서 spawnQueue를 마지막으로 비우는 스폰이 일어날 때
    // 방금 스폰된(아직 안 죽은) 몬스터를 무시하고 day로 전환해버렸다.
    const manager = new WaveManager({ rng: seededRng(13) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night

    const wave1 = wavesData.waves[0]!;
    const alive = drainMinionSpawns(manager, wave1, () => {});

    expect(alive).toBe(baseTotal(wave1));
    // 마지막 몬스터가 방금 스폰됐고 아직 안 죽었으니, 스폰 큐가 이 틱에 비워졌더라도
    // 여전히 밤이어야 한다.
    expect(manager.currentPhase).toBe('night');
  });

  it('엘리트는 확률 굴림이라 기본 총원과 상한 사이에서만 나온다', () => {
    // 시드를 바꿔가며 여러 밤을 굴려도 스폰 수가 항상 [base, base+count] 안이고,
    // 굴림에 성공한 판에서는 실제로 엘리트 타입이 나오는지 확인한다.
    const wave3 = wavesData.waves[2]!;
    expect(wave3.elite).toBeDefined();

    let sawElite = false;
    let sawNoElite = false;
    for (let seed = 1; seed <= 24; seed += 1) {
      const manager = new WaveManager({ rng: seededRng(seed * 101) });
      manager.debugJumpToWave(3);

      const spawned: string[] = [];
      const alive = drainMinionSpawns(manager, wave3, (type) => spawned.push(type));

      expect(alive).toBeGreaterThanOrEqual(baseTotal(wave3));
      expect(alive).toBeLessThanOrEqual(maxTotal(wave3));
      const eliteCount = spawned.filter((t) => t === wave3.elite!.type).length;
      expect(eliteCount).toBe(alive - baseTotal(wave3));
      if (eliteCount > 0) sawElite = true;
      else sawNoElite = true;
    }

    // chance 0.3이면 24판 안에 나온 판과 안 나온 판이 둘 다 있어야 정상이다.
    expect(sawElite).toBe(true);
    expect(sawNoElite).toBe(true);
  });

  describe('debugJumpToWave(테스트용)', () => {
    it('중간 웨이브를 건너뛰고 지정한 웨이브의 밤을 바로 시작한다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });

      const ok = manager.debugJumpToWave(5);

      expect(ok).toBe(true);
      expect(manager.currentPhase).toBe('night');
      expect(manager.currentWave).toBe(5);
    });

    it('스폰 큐가 목표 웨이브 구성으로 채워지고, 전멸 후 그 웨이브의 보스가 나온다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });
      manager.debugJumpToWave(5);

      const wave5 = wavesData.waves[4]!;
      const spawnedTypes: string[] = [];
      drainMinionSpawns(manager, wave5, (type) => spawnedTypes.push(type));

      expect(spawnedTypes).toContain('lava_slime'); // 5웨이브에만 있는 구성인지 확인
      // 전멸시키면 최종 보스가 나온다 — 다른 웨이브에서는 나올 수 없는 타입.
      const bossSpawns: string[] = [];
      manager.tick(0.1, () => 0, (type) => bossSpawns.push(type));
      expect(bossSpawns).toEqual(['boss_dark_knight']);
    });

    it('존재하지 않는 웨이브 번호는 무시하고 false를 돌려준다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });

      const before = manager.currentPhase;
      const ok = manager.debugJumpToWave(wavesData.waves.length + 1);

      expect(ok).toBe(false);
      expect(manager.currentPhase).toBe(before);
    });

    it('victory/defeat 상태에서는 아무 일도 하지 않는다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });
      manager.markDefeat();

      const ok = manager.debugJumpToWave(5);

      expect(ok).toBe(false);
      expect(manager.currentPhase).toBe('defeat');
    });
  });
});
