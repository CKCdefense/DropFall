import { companionData, type PersonaTraitDelta } from '../data';
import { type CorePersonaTraits, moodBucketFor, pickFallbackLine } from './corePersona';

export { createInitialPersonaTraits as createInitialCompanionTraits } from './corePersona';

/** 티모시와 플레이어 사이의 관계 트레잇을 바꾸는 이벤트 종류. */
export type CompanionPersonaEventKind =
  | 'coreDeposit'
  | 'proximityInteract'
  | 'companionDowned'
  | 'companionRevived'
  | 'waveEnd'
  | 'playerMessage';

/** GameRoom이 틱마다 드레인해서 소비하는 이벤트. */
export interface CompanionPersonaEvent {
  kind: CompanionPersonaEventKind;
  /** 이 대사가 향하는 플레이어(실제 행위자 또는 가장 가까운 플레이어). */
  playerId: string;
  /** 이벤트 발생 시점의 그 플레이어 트레잇(적용 후 값). */
  traits: CorePersonaTraits;
  wave: number;
  /** kind === 'playerMessage'일 때만 채워진다 — 채팅으로 실제 건넨 말 그대로. */
  message?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 이벤트 하나를 (플레이어별) 트레잇에 반영한다. corePersona의 applyPersonaEvent와 같은
 * 규칙이지만 이벤트 종류가 다르다(코어는 방 전체, 티모시는 플레이어별). */
export function applyCompanionPersonaEvent(
  traits: CorePersonaTraits,
  kind: CompanionPersonaEventKind,
  weights: Record<CompanionPersonaEventKind, PersonaTraitDelta> = companionData.persona.eventWeights,
  bounds: { min: number; max: number } = {
    min: companionData.persona.traitMin,
    max: companionData.persona.traitMax,
  },
): CorePersonaTraits {
  const delta = weights[kind];
  return {
    trust: clamp(traits.trust + delta.trust, bounds.min, bounds.max),
    efficiency: clamp(traits.efficiency + delta.efficiency, bounds.min, bounds.max),
    recklessness: clamp(traits.recklessness + delta.recklessness, bounds.min, bounds.max),
  };
}

const EVENT_LABEL: Record<CompanionPersonaEventKind, string> = {
  coreDeposit: '이 플레이어가 방금 채집한 자원을 코어 창고에 납품했다',
  proximityInteract: '이 플레이어가 방금 옆에 와서 말을 걸었다',
  companionDowned: '몬스터에게 맞아 방금 쓰러졌다',
  companionRevived: '낮이 밝아 방금 다시 일어났다',
  waveEnd: '이번 밤(웨이브)이 방금 끝났다',
  // playerMessage는 event.message가 항상 채워져 있어 buildCompanionPersonaPrompt에서
  // 이 라벨 대신 실제 메시지를 쓴다 — 여기 값은 그 경로가 깨졌을 때의 방어용 문구.
  playerMessage: '이 플레이어가 채팅으로 말을 걸었다',
};

/**
 * GameRoom이 LLM에 보낼 system/user 프롬프트를 조립한다. corePersona.buildPersonaPrompt와
 * 같은 모양이지만 화자가 코어가 아니라 티모시고, 무드가 방 전체가 아니라 이 이벤트의
 * 대상 플레이어 개인 트레잇에서 나온다. playerMessage는 정해진 상황 설명 대신 채팅으로
 * 온 실제 문장을 그대로 질문/말로 건넨다(예: "@티모시 밥 먹었냐").
 */
export function buildCompanionPersonaPrompt(event: CompanionPersonaEvent): { system: string; user: string } {
  const mood = moodBucketFor(event.traits, companionData.persona.moodThreshold);
  const system =
    `너는 생존 디펜스 게임 DropFall의 AI 동반자 "${companionData.name}"다. 자원을 채집해 나르는 ` +
    '작은 로봇이자 팀의 마스코트다. 지금 말을 거는 대상 플레이어와의 관계에 따라 성격이 변한다 — ' +
    `지금 그 플레이어를 향한 무드는 "${mood}"(trust=${event.traits.trust.toFixed(1)}, ` +
    `efficiency=${event.traits.efficiency.toFixed(1)}, recklessness=${event.traits.recklessness.toFixed(1)}). ` +
    '한국어로, 짧게 한 문장(15~30자)만 대사로 말해라. 설명이나 따옴표 없이 대사 자체만 출력해라.';
  const user =
    event.kind === 'playerMessage' && event.message
      ? `이 플레이어가 채팅으로 너에게 직접 말을 걸었다: "${event.message}". 그 말에 대답해줘.`
      : `${EVENT_LABEL[event.kind]}(현재 웨이브 ${event.wave}). 지금 심정을 한 줄로 말해줘.`;
  return { system, user };
}

/** "@티모시 ..." 로 시작하는 채팅이면 그 뒤 내용을, 아니면 null을 돌려준다. */
export function parseCompanionMention(text: string): string | null {
  const prefix = `@${companionData.name}`;
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length).trim();
  return rest.length > 0 ? rest : null;
}

/** LLM 호출 실패/타임아웃 시 대신 내보낼 대사. */
export function pickCompanionFallbackLine(
  traits: CorePersonaTraits,
  rng: () => number = Math.random,
): string {
  return pickFallbackLine(traits, companionData.persona, rng);
}
