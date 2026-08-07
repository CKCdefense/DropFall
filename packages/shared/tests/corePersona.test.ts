import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import {
  applyPersonaEvent,
  createInitialPersonaTraits,
  moodBucketFor,
  pickFallbackLine,
} from '../src/sim/corePersona';
import { corePersonaData } from '../src/data';

/** 매번 같은 시퀀스를 내는 결정론적 rng — colony.test.ts/wave.test.ts와 동일 패턴. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe('applyPersonaEvent — 이벤트별 트레잇 델타 적용', () => {
  it('waveEnd는 trust만 올린다', () => {
    const traits = applyPersonaEvent(createInitialPersonaTraits(), 'waveEnd');
    expect(traits.trust).toBe(corePersonaData.eventWeights.waveEnd.trust);
    expect(traits.efficiency).toBe(0);
    expect(traits.recklessness).toBe(0);
  });

  it('colonyDestroyed는 efficiency와 recklessness를 올린다', () => {
    const traits = applyPersonaEvent(createInitialPersonaTraits(), 'colonyDestroyed');
    expect(traits.trust).toBe(0);
    expect(traits.efficiency).toBe(corePersonaData.eventWeights.colonyDestroyed.efficiency);
    expect(traits.recklessness).toBe(corePersonaData.eventWeights.colonyDestroyed.recklessness);
  });

  it('traitMax/traitMin 밖으로는 절대 나가지 않는다(계속 같은 이벤트를 줘도 클램프된다)', () => {
    let traits = createInitialPersonaTraits();
    for (let i = 0; i < 1000; i += 1) traits = applyPersonaEvent(traits, 'waveEnd');
    expect(traits.trust).toBe(corePersonaData.traitMax);

    traits = { trust: corePersonaData.traitMin, efficiency: 0, recklessness: corePersonaData.traitMin };
    for (let i = 0; i < 1000; i += 1) {
      traits = applyPersonaEvent(traits, 'colonyDestroyed', corePersonaData.eventWeights, {
        min: corePersonaData.traitMin,
        max: corePersonaData.traitMax,
      });
    }
    // recklessness는 델타가 양수라 위로 클램프, efficiency도 마찬가지.
    expect(traits.efficiency).toBeLessThanOrEqual(corePersonaData.traitMax);
    expect(traits.recklessness).toBeLessThanOrEqual(corePersonaData.traitMax);
  });
});

describe('moodBucketFor — trust/recklessness 격차로 무드 결정', () => {
  it('trust - recklessness가 threshold 이상이면 warm', () => {
    const mood = moodBucketFor(
      { trust: corePersonaData.moodThreshold, efficiency: 0, recklessness: 0 },
      corePersonaData.moodThreshold,
    );
    expect(mood).toBe('warm');
  });

  it('trust - recklessness가 -threshold 이하면 cold', () => {
    const mood = moodBucketFor(
      { trust: 0, efficiency: 0, recklessness: corePersonaData.moodThreshold },
      corePersonaData.moodThreshold,
    );
    expect(mood).toBe('cold');
  });

  it('그 사이면 neutral', () => {
    const mood = moodBucketFor({ trust: 0, efficiency: 0, recklessness: 0 }, corePersonaData.moodThreshold);
    expect(mood).toBe('neutral');
  });
});

describe('pickFallbackLine — LLM 실패 시 대신 뽑는 대사', () => {
  it('무드 버킷에 속한 문장 중 하나를 결정론적으로 고른다(같은 시드는 같은 결과)', () => {
    const traits = { trust: corePersonaData.moodThreshold, efficiency: 0, recklessness: 0 };
    const lineA = pickFallbackLine(traits, corePersonaData, seededRng(7));
    const lineB = pickFallbackLine(traits, corePersonaData, seededRng(7));
    expect(lineA).toBe(lineB);
    expect(corePersonaData.fallbackLines.warm).toContain(lineA);
  });
});

describe('World — 코어 페르소나 이벤트 적재', () => {
  it('웨이브가 끝나면(day 커맨드로 강제 종료해도) waveEnd 이벤트가 쌓인다', () => {
    const world = new World({ rng: seededRng(1) });
    world.addPlayer('p1', 0, 0);
    world.tick(1); // day → night 전환 전, 아무 이벤트도 없어야 한다
    expect(world.drainPersonaEvents()).toHaveLength(0);

    world.runDevCommand('p1', 'wave 1'); // 첫 밤 시작
    world.runDevCommand('p1', 'day'); // 정상 경로와 같은 함수(onDayBegan)로 강제 종료

    const events = world.drainPersonaEvents();
    expect(events.some((e) => e.kind === 'waveEnd')).toBe(true);
  });

  it('drainPersonaEvents는 한 번 꺼내면 큐를 비운다', () => {
    const world = new World({ rng: seededRng(1) });
    world.addPlayer('p1', 0, 0);
    world.runDevCommand('p1', 'wave 1');
    world.runDevCommand('p1', 'day');

    expect(world.drainPersonaEvents().length).toBeGreaterThan(0);
    expect(world.drainPersonaEvents()).toHaveLength(0);
  });

  it('requestCoreInteraction은 쿨다운 안에서 두 번째 호출을 거부한다', () => {
    const world = new World({ rng: seededRng(1) });
    world.addPlayer('p1', 0, 0);

    expect(world.requestCoreInteraction()).toBe(true);
    expect(world.drainPersonaEvents().some((e) => e.kind === 'coreInteract')).toBe(true);

    expect(world.requestCoreInteraction()).toBe(false);
    expect(world.drainPersonaEvents()).toHaveLength(0);

    world.tick(corePersonaData.coreInteractionCooldownSeconds + 0.1);
    expect(world.requestCoreInteraction()).toBe(true);
  });
});
