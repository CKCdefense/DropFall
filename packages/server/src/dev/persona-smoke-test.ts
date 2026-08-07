import { buildPersonaPrompt, applyPersonaEvent, createInitialPersonaTraits, type PersonaEvent } from '@dropfall/shared';
import { generateCoreCommentary, type PersonaProvider } from '../persona/corePersonaClient';

/**
 * 코어 AI 페르소나가 **실제로 뭐라고 말하는지** 눈으로 확인하는 스크립트. 서버를 띄울
 * 필요 없다 — corePersonaClient를 직접 호출한다. 유닛 테스트(shared/tests/ai)는 순수
 * 로직(트레잇 계산/폴백 대사)만 검증하고 진짜 LLM 호출은 안 하므로, "실제 응답 텍스트"를
 * 보려면 이 스크립트가 필요하다.
 *
 *   # packages/server/.env에 키 채운 뒤
 *   pnpm --filter @dropfall/server smoke:persona
 *
 * direct/hchat 둘 다 키가 설정된 쪽만 시도한다. 키가 없는 provider는 건너뛴다
 * (generateCoreCommentary가 null을 돌려주는 게 정상 — 그때 서버는 폴백 대사로 대체한다).
 */

try {
  process.loadEnvFile();
} catch {
  // .env 없음 — 무시(환경변수가 이미 셸에 있을 수도 있다)
}

const PROVIDERS: PersonaProvider[] = ['direct', 'hchat'];

const SAMPLE_EVENTS: { label: string; event: PersonaEvent }[] = [
  {
    label: '웨이브 종료(협동 잘함)',
    event: { kind: 'waveEnd', traits: applyPersonaEvent(createInitialPersonaTraits(), 'waveEnd'), wave: 3 },
  },
  {
    label: '콜로니 파괴',
    event: {
      kind: 'colonyDestroyed',
      traits: applyPersonaEvent(createInitialPersonaTraits(), 'colonyDestroyed'),
      wave: 2,
    },
  },
  {
    label: '코어 상호작용',
    event: {
      kind: 'coreInteract',
      traits: applyPersonaEvent(createInitialPersonaTraits(), 'coreInteract'),
      wave: 1,
    },
  },
];

async function main(): Promise<void> {
  let attempted = 0;

  for (const provider of PROVIDERS) {
    console.log(`\n=== provider: ${provider} ===`);
    for (const { label, event } of SAMPLE_EVENTS) {
      const { system, user } = buildPersonaPrompt(event);
      const text = await generateCoreCommentary(provider, system, user);
      attempted += 1;

      if (text === null) {
        console.log(`[persona-smoke] ${label}: (null — 키 미설정이거나 호출 실패, 폴백 대사로 대체될 상황)`);
        continue;
      }
      console.log(`[persona-smoke] ${label}: "${text}"`);
    }
  }

  console.log(`\n[persona-smoke] ${attempted}건 시도 완료`);
}

main().catch((error) => {
  console.error('[persona-smoke] 실패:', error);
  process.exit(1);
});
