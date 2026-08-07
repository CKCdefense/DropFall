import { describe, expect, it } from 'vitest';
import {
  buildCompanionPersonaPrompt,
  companionData,
  createInitialCompanionTraits,
  World,
  type CompanionPersonaEvent,
} from '@dropfall/shared';
import { activePersonaProvider, generateWithTools } from '../src/persona/corePersonaClient';
import { COMPANION_TOOLS, executeCompanionTool } from '../src/persona/companionTools';

/**
 * **진짜 LLM(hchat/direct)을 호출하는 통합 테스트다 — API 요금이 든다.**
 *
 * shared/tests/ai의 유닛 테스트는 순수 로직(트레잇 계산/프롬프트 조립/폴백 대사 선택)만
 * 검증하고 네트워크 호출은 절대 안 한다. "티모시가 실제로 질문에 맞게 답하는가(고정
 * 폴백 문장만 반복하는 게 아니라)", "실제로 도구를 써서 진짜 게임 상태를 조회하는가"는
 * 그 테스트들이 검증하지 못하는 영역이라 이 파일이 따로 존재한다.
 *
 * 루틴 `pnpm test`(= `pnpm -r test`)에 걸리지 않게 일부러 "test"가 아니라
 * "test:integration"이라는 별도 스크립트로 뺐다 — 실행하려면 명시적으로:
 *
 *   pnpm --filter @dropfall/server run test:integration
 *
 * API 키가 없으면(.env 미설정, CI 등) 전부 건너뛴다.
 */

try {
  process.loadEnvFile();
} catch {
  // .env 없음 — 무시(환경변수가 이미 셸에 있을 수도 있다)
}

const hasKey = Boolean(process.env.CORE_PERSONA_ANTHROPIC_API_KEY) || Boolean(process.env.H_CHAT_API_KEY);
const provider = activePersonaProvider();

/** 도구 조회가 그럴듯한 값을 돌려주도록 창고에 나무/돌을 채워둔 World. */
function createSeededWorld(): World {
  const world = new World();
  world.addPlayer('tester', 0, 0);
  world.runDevCommand('tester', 'store wood 12');
  world.runDevCommand('tester', 'store stone 5');
  return world;
}

/** 실제 GameRoom.handleCompanionPersonaEvent와 같은 경로(도구 사용 포함)로 질문한다. */
function askCompanion(world: World, message: string, history: CompanionPersonaEvent['history'] = []): Promise<string | null> {
  const event: CompanionPersonaEvent = {
    kind: 'playerMessage',
    playerId: 'tester',
    traits: createInitialCompanionTraits(),
    wave: 1,
    message,
    history,
  };
  const { system, messages } = buildCompanionPersonaPrompt(event);
  return generateWithTools(provider, system, messages, COMPANION_TOOLS, (name) => executeCompanionTool(world, name));
}

describe.skipIf(!hasKey)('티모시 — 실제 LLM 응답', () => {
  it(
    '"@티모시 밥 먹었냐"에 폴백 문장이 아닌 답을 한다',
    async () => {
      const text = await askCompanion(createSeededWorld(), '밥 먹었냐');

      expect(text).not.toBeNull();
      expect(text!.length).toBeGreaterThan(0);

      const fallbackLines = [
        ...companionData.persona.fallbackLines.warm,
        ...companionData.persona.fallbackLines.cold,
        ...companionData.persona.fallbackLines.neutral,
      ];
      expect(fallbackLines).not.toContain(text);
    },
    15000,
  );

  it(
    '서로 다른 질문에는 서로 다른 대답을 한다(고정 문구 반복이 아님을 확인)',
    async () => {
      const world = createSeededWorld();
      const [a, b] = await Promise.all([
        askCompanion(world, '밥 먹었냐'),
        askCompanion(world, '오늘 날씨 어때'),
      ]);

      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a).not.toBe(b);
    },
    15000,
  );

  it(
    '"나무 몇 개 있어?"라고 물으면 실제로 도구를 써서 창고 값을 조회해 답한다(에이전트 루프)',
    async () => {
      const world = createSeededWorld(); // 나무 12개 시딩
      const text = await askCompanion(world, '지금 나무 몇 개 있어? 숫자로 알려줘');

      expect(text).not.toBeNull();
      // 도구를 실제로 호출했다면 시딩한 값(12)이 답변에 그대로 드러나야 한다 —
      // 도구 없이 지어낸 답이라면 이 숫자가 우연히 맞을 가능성은 낮다.
      expect(text).toContain('12');
    },
    20000,
  );

  it(
    '직전 대화 기록(history)이 있으면 그 맥락을 반영해 답한다(메모리)',
    async () => {
      const world = createSeededWorld();
      const history = [
        { role: 'user' as const, content: '내 이름은 몽몽이야' },
        { role: 'assistant' as const, content: '오, 몽몽이구나! 반가워.' },
      ];
      const text = await askCompanion(world, '내 이름이 뭐라고 했지?', history);

      expect(text).not.toBeNull();
      expect(text).toContain('몽몽');
    },
    20000,
  );
});

// hasKey가 false면(로컬에 .env가 없거나 키가 비어있으면) 위 describe가 전부 skip되는데,
// 그 사실 자체를 조용히 넘기지 않고 최소 하나는 실행되게 해서 "왜 통과했는지" 눈에 보이게 한다.
describe.skipIf(hasKey)('티모시 — 실제 LLM 응답 (키 없음)', () => {
  it('CORE_PERSONA_ANTHROPIC_API_KEY / H_CHAT_API_KEY가 없어 위 통합 테스트를 건너뛴다', () => {
    expect(hasKey).toBe(false);
  });
});
