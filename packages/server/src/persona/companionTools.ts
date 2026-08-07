import type { World } from '@dropfall/shared';
import type { ToolDefinition } from './corePersonaClient';

/**
 * 티모시가 "@티모시 ..." 채팅에 답하기 전에 스스로 조회할 수 있는 실제 게임 상태.
 * 전부 읽기 전용이다 — 도구로 뭔가를 바꾸게 하지 않는다(질문에 답하는 용도로만 쓴다).
 * 입력 파라미터가 필요 없는 조회라 셋 다 빈 스키마다.
 */
export const COMPANION_TOOLS: ToolDefinition[] = [
  {
    name: 'get_storage',
    description: '코어 창고에 지금 쌓여 있는 자원(나무/돌/부품) 개수를 확인한다.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_wave_status',
    description: '현재 몇 번째 웨이브인지, 낮/밤 중 어느 쪽인지, 남은 시간이 얼마인지 확인한다.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_companion_status',
    description: '티모시 자신의 체력, 지금 들고 있는 자원, 지금 하고 있는 일(채집 중/이동 중/다운 등)을 확인한다.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

/** 도구 이름 → World 조회 결과. 알 수 없는 이름이면 에러 객체를 돌려준다(모델에게 그대로 보여줘도 안전). */
export function executeCompanionTool(world: World, name: string): unknown {
  switch (name) {
    case 'get_storage': {
      const storage = world.getCore().storage;
      return {
        wood: storage.countOf('wood'),
        stone: storage.countOf('stone'),
        parts: storage.countOf('drop_normal'),
      };
    }
    case 'get_wave_status': {
      return {
        wave: world.getCurrentWave(),
        phase: world.getWavePhase(),
        phaseTimeRemainingSeconds: Math.round(world.getPhaseTimeRemaining()),
      };
    }
    case 'get_companion_status': {
      const companion = world.getCompanion();
      return {
        hp: companion.hp,
        maxHp: companion.maxHp,
        carriedWood: companion.carriedWood,
        carriedStone: companion.carriedStone,
        state: companion.state,
      };
    }
    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}
