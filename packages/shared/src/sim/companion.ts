import { companionData } from '../data';

export type CompanionState =
  | 'seeking'
  | 'traveling'
  | 'harvesting'
  | 'returning'
  | 'depositing'
  | 'downed'
  /**
   * 방 설정으로 티모시를 끈 상태. "죽었다"(downed)와 다르다 — 다운은 낮이 되면
   * 되살아나지만 이 상태는 그 방에 티모시가 **처음부터 없는** 것이라 영영 바뀌지 않는다.
   *
   * 필드를 null로 두지 않고 상태 하나로 표현한 이유는, 티모시가 World·스냅샷·렌더러를
   * 관통해 스무 곳 넘게 등장하기 때문이다. null이면 그 전부가 물음표 연산자로 덮이고,
   * 그때 "없음"과 "아직 안 왔음"이 구분되지 않는다. 상태 하나면 이미 있는
   * `state !== 'downed'` 검사 자리에 그대로 얹힌다.
   */
  | 'absent';

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
  /**
   * `moveCompanionToward`가 이동을 전혀 못 시킨 채 연속으로 흐른 시간(초). 몬스터의
   * `stuckSeconds`(world.ts moveMonsterInner)와 같은 용도 — 코어처럼 둥글지 않은
   * 장애물 바로 앞에서 축 슬라이딩만으로는 못 빠져나가는 경우를 대비한 탈출 트리거다.
   */
  stuckSeconds: number;
}

export function createCompanion(
  coreX: number,
  coreY: number,
  enabled = true,
): CompanionEntity {
  return {
    x: coreX + companionData.spawnOffset.x,
    y: coreY + companionData.spawnOffset.y,
    facingX: 0,
    facingY: 1,
    state: enabled ? 'seeking' : 'absent',
    targetNodeId: undefined,
    carriedWood: 0,
    carriedStone: 0,
    hp: companionData.maxHp,
    maxHp: companionData.maxHp,
    harvestTimer: 0,
    stuckSeconds: 0,
  };
}
