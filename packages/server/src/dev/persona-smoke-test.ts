import {
  buildPersonaPrompt,
  applyPersonaEvent,
  createInitialPersonaTraits,
  buildCompanionPersonaPrompt,
  applyCompanionPersonaEvent,
  createInitialCompanionTraits,
  World,
  type CorePersonaTraits,
  type PersonaEvent,
  type PersonaEventKind,
  type CompanionPersonaEvent,
  type CompanionPersonaEventKind,
} from '@dropfall/shared';
import { generateCoreCommentary, generateWithTools, type PersonaProvider } from '../persona/corePersonaClient';
import { COMPANION_TOOLS, executeCompanionTool } from '../persona/companionTools';

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
 *
 * ## 티모시(AI 동반자) 테스트
 *
 * "@티모시 밥 먹었냐"처럼 채팅으로 직접 말 걸었을 때 **실제로 뭐라고 답하는지**를
 * 서버/클라이언트 없이 바로 확인하려면 `--message`를 준다(companion 모드가 자동으로
 * 켜지고 kind는 playerMessage로 고정된다). 이 경로는 도구 사용(에이전트 루프)도 실제로
 * 켜져 있다 — "나무 몇 개 있어?"처럼 물어보면 티모시가 실제로 조회해서 답하는지까지
 * 확인할 수 있게, 창고에 나무 12개/돌 5개를 미리 채워둔 World를 하나 만들어 물어본다:
 *
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts \
 *     --message="밥 먹었냐" --provider=hchat --repeat=3
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts \
 *     --message="나무 몇 개 있어?" --provider=hchat
 *
 * 그 외 티모시 트리거(코어 납품/근접 상호작용/다운/부활/웨이브 종료)를 보려면
 * `--companion`만 켠다(인자 없으면 기본 샘플 5종, `--kind`로 하나만 골라도 됨):
 *
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts --companion
 *   pnpm --filter @dropfall/server exec tsx src/dev/persona-smoke-test.ts \
 *     --companion --kind=companionDowned --trust=-5 --recklessness=5
 *
 * | 플래그(티모시 전용) | 설명 |
 * |---|---|
 * | --message | 이 문장으로 "@티모시 ..." 채팅을 재현한다(가장 흔히 쓸 플래그) |
 * | --companion | 켜면 티모시 모드(코어 대신). --message가 있으면 자동으로 켜진다 |
 * | --kind | coreDeposit \| proximityInteract \| companionDowned \| companionRevived \| waveEnd \| playerMessage |
 */

try {
  process.loadEnvFile();
} catch {
  // .env 없음 — 무시(환경변수가 이미 셸에 있을 수도 있다)
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const raw of argv) {
    const withValue = /^--([^=]+)=(.*)$/.exec(raw);
    if (withValue) {
      args[withValue[1]!] = withValue[2]!;
      continue;
    }
    // `--companion`처럼 값 없는 불리언 플래그도 허용한다("있으면 켠다"가 자연스럽다).
    const bareFlag = /^--(.+)$/.exec(raw);
    if (bareFlag) args[bareFlag[1]!] = '1';
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

const DEFAULT_COMPANION_SAMPLES: { label: string; kind: CompanionPersonaEventKind; wave: number }[] = [
  { label: '코어 납품', kind: 'coreDeposit', wave: 1 },
  { label: '근접 상호작용', kind: 'proximityInteract', wave: 1 },
  { label: '다운', kind: 'companionDowned', wave: 2 },
  { label: '부활', kind: 'companionRevived', wave: 2 },
  { label: '웨이브 종료', kind: 'waveEnd', wave: 3 },
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

/**
 * callAndPrint의 티모시 버전 — buildCompanionPersonaPrompt(messages 배열)를 쓴다는 것과,
 * playerMessage는 실제 도구 사용(에이전트 루프)까지 켠다는 점이 다르다. `world`는
 * playerMessage일 때 도구 실행(창고/웨이브/티모시 상태 조회) 대상이다.
 */
async function callAndPrintCompanion(
  label: string,
  provider: PersonaProvider,
  event: CompanionPersonaEvent,
  repeat: number,
  verbose: boolean,
  world: World,
): Promise<void> {
  const { system, messages } = buildCompanionPersonaPrompt(event);
  if (verbose) {
    console.log(`[persona-smoke] --- 프롬프트(티모시) ---`);
    console.log(`[persona-smoke] system: ${system}`);
    for (const turn of messages) console.log(`[persona-smoke] ${turn.role}: ${turn.content}`);
  }

  for (let i = 0; i < repeat; i += 1) {
    const text =
      event.kind === 'playerMessage'
        ? await generateWithTools(provider, system, messages, COMPANION_TOOLS, (name) =>
            executeCompanionTool(world, name),
          )
        : await generateCoreCommentary(provider, system, messages);
    const tag = repeat > 1 ? ` (#${i + 1}/${repeat})` : '';
    if (text === null) {
      console.log(`[persona-smoke] [${provider}] 티모시:${label}${tag}: (null — 키 미설정이거나 호출 실패)`);
      continue;
    }
    console.log(`[persona-smoke] [${provider}] 티모시:${label}${tag}: "${text}"`);
  }
}

/**
 * 티모시 도구 호출(get_storage/get_wave_status/get_companion_status)이 그럴듯한 값을
 * 돌려주도록 최소한으로 채운 World. 실제 서버 없이도 "나무 몇 개 있어?" 같은 질문에
 * 티모시가 실제로 조회해서 답하는지 확인할 수 있다.
 */
function createSmokeWorld(): World {
  const world = new World();
  world.addPlayer('tester', 0, 0);
  world.runDevCommand('tester', 'store wood 12');
  world.runDevCommand('tester', 'store stone 5');
  return world;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const providers = providersFrom(args.provider);
  const repeat = Math.max(1, Number(args.repeat) || 1);
  const world = createSmokeWorld();

  const traitsFromArgs = (): CorePersonaTraits => ({
    trust: Number(args.trust) || 0,
    efficiency: Number(args.efficiency) || 0,
    recklessness: Number(args.recklessness) || 0,
  });

  // --message가 있으면 "@티모시 ..." 채팅으로 직접 말 거는 상황을 그대로 재현한다
  // (companion 모드 자동 적용, kind는 playerMessage로 고정) — 실서비스에서 이 정확한
  // 문장을 받았을 때 티모시가 뭐라고 답하는지를 서버/클라이언트 없이 바로 본다.
  if (args.message) {
    const traits = traitsFromArgs();
    const wave = Number(args.wave) || 1;
    const event: CompanionPersonaEvent = {
      kind: 'playerMessage',
      playerId: 'tester',
      traits,
      wave,
      message: args.message,
    };

    console.log(`[persona-smoke] 티모시에게 말 걸기: "${args.message}" traits=${JSON.stringify(traits)}`);
    for (const provider of providers) {
      await callAndPrintCompanion('playerMessage', provider, event, repeat, true, world);
    }
    return;
  }

  if (args.companion !== undefined) {
    const customCompanionKind = args.kind as CompanionPersonaEventKind | undefined;

    if (customCompanionKind) {
      const traits = applyCompanionPersonaEvent(createInitialCompanionTraits(), customCompanionKind);
      const wave = Number(args.wave) || 1;
      const event: CompanionPersonaEvent = { kind: customCompanionKind, playerId: 'tester', traits, wave };

      console.log(
        `[persona-smoke] 티모시 커스텀 실행: kind=${customCompanionKind} wave=${wave} traits=${JSON.stringify(traits)}`,
      );
      for (const provider of providers) {
        await callAndPrintCompanion(customCompanionKind, provider, event, repeat, true, world);
      }
      return;
    }

    let attempted = 0;
    for (const provider of providers) {
      console.log(`\n=== provider: ${provider} (티모시) ===`);
      for (const { label, kind, wave } of DEFAULT_COMPANION_SAMPLES) {
        const traits = applyCompanionPersonaEvent(createInitialCompanionTraits(), kind);
        await callAndPrintCompanion(label, provider, { kind, playerId: 'tester', traits, wave }, 1, false, world);
        attempted += 1;
      }
    }
    console.log(`\n[persona-smoke] ${attempted}건 시도 완료(티모시)`);
    return;
  }

  const customKind = args.kind as PersonaEventKind | undefined;

  if (customKind) {
    // --kind가 있으면 커스텀 단일 실험 모드 — 트레잇도 직접 지정한 값을 그대로 쓴다
    // (applyPersonaEvent로 자동 계산하지 않는다 — "이 정확한 무드일 때 뭐라고 하는지"를
    // 보려는 것이므로 값을 있는 그대로 넘기는 게 맞다).
    const traits = traitsFromArgs();
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
