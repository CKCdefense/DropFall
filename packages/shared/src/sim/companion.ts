import { companionData } from '../data';

export type CompanionState =
  | 'seeking'
  | 'traveling'
  | 'harvesting'
  | 'returning'
  | 'depositing'
  | 'downed';

/**
 * 방(팀)당 1마리인 AI 동반자("티모시"). `players`/`monsters`처럼 Map으로 관리하지 않는다 —
 * 여러 개일 이유가 없어서 World에 필드 하나로 둔다
 * (docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md).
 */
export interface CompanionEntity {
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  state: CompanionState;
  targetNodeId?: string;
  carriedWood: number;
  carriedStone: number;
  hp: number;
  maxHp: number;
  /** harvestIntervalSeconds 쿨다운. */
  harvestTimer: number;
}

export function createCompanion(coreX: number, coreY: number): CompanionEntity {
  return {
    x: coreX + companionData.spawnOffset.x,
    y: coreY + companionData.spawnOffset.y,
    facingX: 0,
    facingY: 1,
    state: 'seeking',
    targetNodeId: undefined,
    carriedWood: 0,
    carriedStone: 0,
    hp: companionData.maxHp,
    maxHp: companionData.maxHp,
    harvestTimer: 0,
  };
}
