import {
  buildPersonaPrompt,
  applyPersonaEvent,
  createInitialPersonaTraits,
  type CorePersonaTraits,
  type PersonaEvent,
  type PersonaEventKind,
} from '@dropfall/shared';
import { generateCoreCommentary, type PersonaProvider } from '../persona/corePersonaClient';

/**
 * 코어 AI 페르소나가 **실제로 뭐라고 말하는지** 눈으로 확인하는 스크립트. 서버를 띄울
 * 필요 없다 — corePersonaClient를 직접 호출한다. 유닛 테스트(shared/tests/ai)는 순수
 * 로직(트레잇 계산/폴백 대사)만 검증하고 진짜 LLM 호출은 안 하므로, "실제 응답 텍스트"를
 * 보려면 이 스크립트가 필요하다.
 *
 * **RAG 아니다** — 검색/벡터DB 없음. 트레잇 숫자 3개 + 프롬프트 템플릿(corePersona.ts의
 * buildPersonaPrompt) → LLM 호출이 전부다. "품질 확인"은 결국 이 프롬프트가 트레잇 값에
 * 따라 얼마나 그럴듯한 한 줄을 뽑아내는지를 보는 것과 같다.
 *
 * 인자 없이 실행하면 기본 샘플 3종(웨이브 종료/콜로니 파괴/코어 상호작용)을 두 provider로
 * 한 번씩 — 이전과 동일한 데모 동작:
 *
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts
 *
 * 트레잇/이벤트/provider를 직접 바꿔가며 실험하려면 인자를 준다(package.json의 "test"
 * 스크립트 아니라서 `--` 없이 그냥 뒤에 붙이면 된다 — pnpm run 스크립트를 거치는
 * `smoke:persona`가 아니라 `exec tsx ...`로 직접 부르는 걸 추천):
 *
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts \
 *     --kind=waveEnd --wave=7 --trust=8 --efficiency=-2 --recklessness=1 \
 *     --provider=hchat --repeat=3
 *
 * | 플래그 | 기본값 | 설명 |
 * |---|---|---|
 * | --kind | (없으면 기본 샘플 3종 전부) | waveEnd \| colonyDestroyed \| coreInteract |
 * | --wave | 3 | 프롬프트에 들어가는 웨이브 번호 |
 * | --trust / --efficiency / --recklessness | 0 | 트레잇 값 직접 지정(모드 실험용) |
 * | --provider | direct,hchat 둘 다 | direct \| hchat \| both |
 * | --repeat | 1 | 같은 입력으로 N번 호출 — 응답 편차/일관성 확인용 |
 */

try {
  process.loadEnvFile();
} catch {
  // .env 없음 — 무시(환경변수가 이미 셸에 있을 수도 있다)
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(raw);
    if (match) args[match[1]!] = match[2]!;
  }
  return args;
}

function providersFrom(flag: string | undefined): PersonaProvider[] {
  if (flag === 'direct' || flag === 'hchat') return [flag];
  return ['direct', 'hchat'];
}

const DEFAULT_SAMPLES: { label: string; kind: PersonaEventKind; wave: number }[] = [
  { label: '웨이브 종료(협동 잘함)', kind: 'waveEnd', wave: 3 },
  { label: '콜로니 파괴', kind: 'colonyDestroyed', wave: 2 },
  { label: '코어 상호작용', kind: 'coreInteract', wave: 1 },
];

async function callAndPrint(
  label: string,
  provider: PersonaProvider,
  event: PersonaEvent,
  repeat: number,
  verbose: boolean,
): Promise<void> {
  const { system, user } = buildPersonaPrompt(event);
  if (verbose) {
    console.log(`[persona-smoke] --- 프롬프트 ---`);
    console.log(`[persona-smoke] system: ${system}`);
    console.log(`[persona-smoke] user: ${user}`);
  }

  for (let i = 0; i < repeat; i += 1) {
    const text = await generateCoreCommentary(provider, system, user);
    const tag = repeat > 1 ? ` (#${i + 1}/${repeat})` : '';
    if (text === null) {
      console.log(`[persona-smoke] [${provider}] ${label}${tag}: (null — 키 미설정이거나 호출 실패)`);
      continue;
    }
    console.log(`[persona-smoke] [${provider}] ${label}${tag}: "${text}"`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const providers = providersFrom(args.provider);
  const repeat = Math.max(1, Number(args.repeat) || 1);

  const customKind = args.kind as PersonaEventKind | undefined;

  if (customKind) {
    // --kind가 있으면 커스텀 단일 실험 모드 — 트레잇도 직접 지정한 값을 그대로 쓴다
    // (applyPersonaEvent로 자동 계산하지 않는다 — "이 정확한 무드일 때 뭐라고 하는지"를
    // 보려는 것이므로 값을 있는 그대로 넘기는 게 맞다).
    const traits: CorePersonaTraits = {
      trust: Number(args.trust) || 0,
      efficiency: Number(args.efficiency) || 0,
      recklessness: Number(args.recklessness) || 0,
    };
    const wave = Number(args.wave) || 1;
    const event: PersonaEvent = { kind: customKind, traits, wave };

    console.log(`[persona-smoke] 커스텀 실행: kind=${customKind} wave=${wave} traits=${JSON.stringify(traits)}`);
    for (const provider of providers) {
      await callAndPrint(customKind, provider, event, repeat, true);
    }
    return;
  }

  // 인자 없음 — 기존 데모 동작(기본 샘플 3종 × provider 전부, 1회씩)
  let attempted = 0;
  for (const provider of providers) {
    console.log(`\n=== provider: ${provider} ===`);
    for (const { label, kind, wave } of DEFAULT_SAMPLES) {
      const traits = applyPersonaEvent(createInitialPersonaTraits(), kind);
      await callAndPrint(label, provider, { kind, traits, wave }, 1, false);
      attempted += 1;
    }
  }
  console.log(`\n[persona-smoke] ${attempted}건 시도 완료`);
}

main().catch((error) => {
  console.error('[persona-smoke] 실패:', error);
  process.exit(1);
});
