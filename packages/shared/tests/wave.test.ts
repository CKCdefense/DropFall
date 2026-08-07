import { describe, expect, it } from 'vitest';
import { WaveManager } from '../src/sim/wave';
import { wavesData } from '../src/data';

/** 매번 같은 시퀀스를 내는 결정론적 rng — 테스트 재현성용. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('WaveManager', () => {
  it('처음엔 day 페이즈로 시작하고 dayDuration만큼 카운트다운한다', () => {
    const manager = new WaveManager({ rng: seededRng(1) });
    expect(manager.currentPhase).toBe('day');
    expect(manager.currentWave).toBe(0);
    expect(manager.phaseTimeRemaining).toBe(wavesData.dayDuration);
  });

  it('day 타이머가 끝나면 1웨이브(night)로 전환하고 몬스터를 스폰한다', () => {
    const manager = new WaveManager({ rng: seededRng(1) });
    const spawned: { type: string; x: number; y: number }[] = [];

    // day → night 전환은 한 틱에서 일어나고, 실제 스폰은 그다음 틱부터 시작된다
    // (한 tick() 호출 안에서 페이즈 전환과 스폰이 동시에 일어나지 않는다).
    manager.tick(wavesData.dayDuration, () => 0, (type, x, y) => spawned.push({ type, x, y }));
    expect(manager.currentPhase).toBe('night');
    expect(manager.currentWave).toBe(1);

    manager.tick(0.001, () => 0, (type, x, y) => spawned.push({ type, x, y }));
    expect(spawned.length).toBeGreaterThan(0);
  });

  it('1웨이브 전체 몬스터가 스폰될 때까지 계속 틱하면 정확히 8마리가 스폰된다', () => {
    const manager = new WaveManager({ rng: seededRng(42) });
    const spawned: string[] = [];

    manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night 전환

    const wave1 = wavesData.waves[0]!;
    // 넉넉하게 night 전체 시간을 잘게 쪼개 틱해서 스폰 큐를 전부 소진시킨다
    for (let i = 0; i < 1000; i += 1) {
      manager.tick(wave1.nightDuration / 1000, () => spawned.length, (type) => spawned.push(type));
      if (spawned.length >= wave1.spawns.trash) break;
    }

    expect(spawned.length).toBe(wave1.spawns.trash);
  });

  it('스폰이 끝나고 몬스터가 전멸하면 다음 웨이브(day)로 넘어간다', () => {
    const manager = new WaveManager({ rng: seededRng(7) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night, wave 1

    const wave1 = wavesData.waves[0]!;
    let spawnedCount = 0;
    for (let i = 0; i < 1000 && spawnedCount < wave1.spawns.trash; i += 1) {
      manager.tick(wave1.nightDuration / 1000, () => spawnedCount, () => {
        spawnedCount += 1;
      });
    }
    expect(spawnedCount).toBe(wave1.spawns.trash);

    // 스폰 큐는 비었지만 아직 몬스터가 안 죽은 상태 — 밤이 계속돼야 한다
    manager.tick(0.1, () => spawnedCount, () => {});
    expect(manager.currentPhase).toBe('night');

    // 전부 처치되면 낮으로 전환
    manager.tick(0.1, () => 0, () => {});
    expect(manager.currentPhase).toBe('day');
    expect(manager.currentWave).toBe(1); // 아직 2웨이브 시작 전
  });

  it('마지막 웨이브까지 클리어하면 victory가 된다', () => {
    const manager = new WaveManager({ rng: seededRng(3) });

    for (let waveNum = 0; waveNum < wavesData.waves.length; waveNum += 1) {
      manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night

      const entry = wavesData.waves[waveNum]!;
      const totalMonsters = Object.values(entry.spawns).reduce((a, b) => a + b, 0);
      let alive = 0;
      for (let i = 0; i < 5000 && alive < totalMonsters; i += 1) {
        manager.tick(entry.nightDuration / 1000, () => alive, () => {
          alive += 1;
        });
      }
      expect(alive).toBe(totalMonsters);

      manager.tick(0.1, () => 0, () => {}); // 전멸 → 다음 페이즈
    }

    expect(manager.currentPhase).toBe('victory');
  });

  it('스폰 지점을 순서대로 순환해서 한 지점에 몰리지 않는다', () => {
    const manager = new WaveManager({ rng: seededRng(5) });

    // 1웨이브(스폰 지점 1곳)를 전부 스폰/전멸시켜 2웨이브(스폰 지점 2곳)까지 진행한다.
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night, wave 1
    const wave1 = wavesData.waves[0]!;
    let alive = 0;
    for (let i = 0; i < 1000 && alive < wave1.spawns.trash; i += 1) {
      manager.tick(wave1.nightDuration / 1000, () => alive, () => {
        alive += 1;
      });
    }
    manager.tick(0.1, () => 0, () => {}); // 전멸 → day
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // day → night, wave 2 시작

    const points: { x: number; y: number }[] = [];
    const wave2 = wavesData.waves[1]!;
    const totalWave2 = Object.values(wave2.spawns).reduce((a, b) => a + b, 0);
    // remainingMonsters는 항상 0으로 둔다 — 이 테스트는 스폰 지점 분포만 확인하면 되고,
    // 몬스터가 실제로 살아남는지는 다른 테스트가 이미 검증한다.
    for (let i = 0; i < 5000 && points.length < totalWave2; i += 1) {
      manager.tick(wave2.nightDuration / 1000, () => 0, (_type, x, y) => {
        points.push({ x, y });
      });
    }

    const unique = new Map<string, number>();
    for (const p of points) {
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      unique.set(key, (unique.get(key) ?? 0) + 1);
    }

    // 스폰 지점 2곳이 번갈아 쓰였다면 두 지점의 스폰 횟수 차이가 1 이하여야 한다
    expect(unique.size).toBe(wave2.spawnPoints);
    const counts = [...unique.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
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
    // 방금 스폰된(아직 안 죽은) 몬스터를 무시하고 day로 전환해버렸다. getRemainingMonsters를
    // "실제로 살아있는 마릿수를 추적하는 콜백"으로 넘겨서, 마지막 스폰이 일어난 바로 그
    // 틱에도 day로 넘어가지 않는지 확인한다.
    const manager = new WaveManager({ rng: seededRng(13) });
    manager.tick(wavesData.dayDuration, () => 0, () => {}); // → night

    const wave1 = wavesData.waves[0]!;
    const totalMonsters = wave1.spawns.trash;

    let aliveNow = 0;
    for (let i = 0; i < 5000 && aliveNow < totalMonsters; i += 1) {
      manager.tick(wave1.nightDuration / 5000, () => aliveNow, () => {
        aliveNow += 1;
      });
    }

    expect(aliveNow).toBe(totalMonsters);
    // 마지막 몬스터가 방금 스폰됐고 아직 안 죽었으니, 스폰 큐가 이 틱에 비워졌더라도
    // 여전히 밤이어야 한다.
    expect(manager.currentPhase).toBe('night');
  });

  describe('debugJumpToWave(테스트용)', () => {
    it('중간 웨이브를 건너뛰고 지정한 웨이브의 밤을 바로 시작한다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });

      const ok = manager.debugJumpToWave(5);

      expect(ok).toBe(true);
      expect(manager.currentPhase).toBe('night');
      expect(manager.currentWave).toBe(5);
    });

    it('스폰 큐가 목표 웨이브 구성으로 채워져서 실제로 그 웨이브의 몬스터가 나온다', () => {
      const manager = new WaveManager({ rng: seededRng(17) });
      manager.debugJumpToWave(5);

      const wave5 = wavesData.waves[4]!;
      const totalMonsters = Object.values(wave5.spawns).reduce((a, b) => a + b, 0);

      const spawnedTypes: string[] = [];
      for (let i = 0; i < 5000 && spawnedTypes.length < totalMonsters; i += 1) {
        manager.tick(wave5.nightDuration / 5000, () => spawnedTypes.length, (type) => {
          spawnedTypes.push(type);
        });
      }

      expect(spawnedTypes.length).toBe(totalMonsters);
      // wave5는 boss 1마리를 포함한다 — 다른 웨이브를 건너뛰지 않고서는 나올 수 없는 타입.
      expect(spawnedTypes).toContain('boss');
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
