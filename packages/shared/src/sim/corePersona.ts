import { corePersonaData, type PersonaTraitDelta } from '../data';

/** 코어의 "성격"을 이루는 세 숫자. 플레이어 행동으로 조금씩 누적된다. */
export interface CorePersonaTraits {
  trust: number;
  efficiency: number;
  recklessness: number;
}

/** 트레잇 변화를 유발하는 이벤트 종류. */
export type PersonaEventKind = 'waveEnd' | 'colonyDestroyed' | 'coreInteract';

/** GameRoom이 틱마다 드레인해서 소비하는 이벤트. */
export interface PersonaEvent {
  kind: PersonaEventKind;
  /** 이벤트 발생 시점의 트레잇(적용 후 값) — LLM 프롬프트/폴백 대사 선택에 그대로 쓴다. */
  traits: CorePersonaTraits;
  /** 발생 시점의 웨이브 번호(1-based). 프롬프트에 맥락으로 넣는다. */
  wave: number;
}

export function createInitialPersonaTraits(): CorePersonaTraits {
  return { trust: 0, efficiency: 0, recklessness: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 이벤트 하나를 트레잇에 반영한다. 각 값은 traitMin~traitMax로 클램프된다. */
export function applyPersonaEvent(
  traits: CorePersonaTraits,
  kind: PersonaEventKind,
  weights: { waveEnd: PersonaTraitDelta; colonyDestroyed: PersonaTraitDelta; coreInteract: PersonaTraitDelta } = corePersonaData.eventWeights,
  bounds: { min: number; max: number } = { min: corePersonaData.traitMin, max: corePersonaData.traitMax },
): CorePersonaTraits {
  const delta = weights[kind];
  return {
    trust: clamp(traits.trust + delta.trust, bounds.min, bounds.max),
    efficiency: clamp(traits.efficiency + delta.efficiency, bounds.min, bounds.max),
    recklessness: clamp(traits.recklessness + delta.recklessness, bounds.min, bounds.max),
  };
}

export type PersonaMood = 'warm' | 'cold' | 'neutral';

/** trust - recklessness가 moodThreshold를 넘으면 warm, 반대로 넘으면 cold. */
export function moodBucketFor(
  traits: CorePersonaTraits,
  threshold: number = corePersonaData.moodThreshold,
): PersonaMood {
  const score = traits.trust - traits.recklessness;
  if (score >= threshold) return 'warm';
  if (score <= -threshold) return 'cold';
  return 'neutral';
}

/**
 * LLM 호출이 실패했거나 타임아웃됐을 때 대신 내보낼 대사. `rng`를 주입받아 테스트에서
 * 결정론적으로 검증한다(wave.ts/colony.ts와 동일 패턴).
 */
export function pickFallbackLine(
  traits: CorePersonaTraits,
  data: { fallbackLines: Record<PersonaMood, string[]>; moodThreshold: number } = corePersonaData,
  rng: () => number = Math.random,
): string {
  const mood = moodBucketFor(traits, data.moodThreshold);
  const lines = data.fallbackLines[mood];
  const index = Math.floor(rng() * lines.length);
  return lines[Math.min(index, lines.length - 1)] ?? lines[0]!;
}

const EVENT_LABEL: Record<PersonaEventKind, string> = {
  waveEnd: '이번 밤(웨이브)이 방금 끝났다',
  colonyDestroyed: '플레이어들이 몬스터 콜로니 하나를 방금 파괴했다',
  coreInteract: '플레이어 한 명이 방금 코어 앞에서 말을 걸었다',
};

/**
 * GameRoom이 LLM에 보낼 system/user 프롬프트를 조립한다. 순수 함수라 테스트/재사용이
 * 쉽다 — 실제 네트워크 호출은 서버 쪽 `corePersonaClient`가 한다.
 */
export function buildPersonaPrompt(event: PersonaEvent): { system: string; user: string } {
  const mood = moodBucketFor(event.traits);
  const system =
    '너는 생존 디펜스 게임 DropFall의 중앙 코어다. 불시착한 생존자들이 구조 신호를 보내려고 ' +
    '지키고 있는 장치이자 유일한 말동무다. 플레이어들의 행동에 따라 성격이 변한다 — 지금 네 ' +
    `무드는 "${mood}"(trust=${event.traits.trust.toFixed(1)}, ` +
    `efficiency=${event.traits.efficiency.toFixed(1)}, recklessness=${event.traits.recklessness.toFixed(1)}). ` +
    '한국어로, 짧게 한 문장(20~40자)만 대사로 말해라. 설명이나 따옴표 없이 대사 자체만 출력해라.';
  const user = `${EVENT_LABEL[event.kind]}(현재 웨이브 ${event.wave}). 지금 심정을 한 줄로 말해줘.`;
  return { system, user };
}
