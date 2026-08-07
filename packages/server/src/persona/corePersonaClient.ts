/**
 * 코어 AI 페르소나 대사를 생성하는 LLM 호출기. 두 경로를 지원한다:
 *
 * - `direct`: Anthropic API에 바로 요청(`x-api-key` + `anthropic-version`).
 * - `hchat`: 사내 게이트웨이(HChat) 경유. Anthropic Messages API와 바디 shape는 같지만
 *   인증 헤더가 `Authorization`(키 그대로, Bearer 접두사 없음)이고 `anthropic-version`이
 *   없다 — 공식 문서(quickstart/claude)의 curl 예시로 확정한 스펙이다.
 *
 * 둘 다 REST/JSON이라 Node 20 기본 `fetch`만으로 충분하다 — 별도 SDK나 프로세스가 필요 없다.
 * 실패(네트워크 오류, 타임아웃, 비-2xx 응답)는 예외를 던지지 않고 `null`을 돌려준다 —
 * 호출부(GameRoom)가 폴백 대사로 대체하는 게 데모 안정성에 더 낫다.
 */

export type PersonaProvider = 'direct' | 'hchat';

const REQUEST_TIMEOUT_MS = 5000;
/** 도구 호출 왕복 상한. 모델이 도구를 계속 요청하는 무한루프를 막는 안전장치다. */
const MAX_TOOL_ITERATIONS = 4;

/** 순수 텍스트 대화 한 마디. 외부(GameRoom 등)는 이 모양만 알면 된다. */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Anthropic 도구 정의(JSON Schema). https://docs.anthropic.com/ko/docs/tool-use */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** 도구 실행기. 실제 게임 상태 조회는 호출부(GameRoom)가 World를 들고 구현한다. */
export type ToolExecutor = (name: string, input: unknown) => unknown | Promise<unknown>;

/** 응답 content 블록. 도구 루프에서는 text/tool_use가, 우리가 되돌려보내는 메시지에는
 * tool_result가 섞여 들어간다 — 셋 다 이 하나의 유니온으로 표현한다. */
interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

/** 도구 루프 내부에서만 쓰는, content가 블록 배열일 수도 있는 확장 메시지 타입. */
interface LooseMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface AnthropicResponse {
  content?: ContentBlock[];
  stop_reason?: string;
}

interface RequestSpec {
  url: string;
  headers: Record<string, string>;
}

function directRequestSpec(): RequestSpec | null {
  // 일반적인 ANTHROPIC_API_KEY가 아니라 이 기능 전용 이름을 쓴다 — Claude Code 같은
  // 도구가 이미 그 이름의 환경변수를 셸에 등록해 놓은 경우가 흔한데, .env 로딩은
  // 이미 있는 환경변수를 덮어쓰지 않아서(process.loadEnvFile()의 dotenv식 동작) 그
  // 값이 조용히 재사용되며 인증 실패(401)로 이어진다. 이름을 분리하면 이 충돌 자체가
  // 안 생긴다.
  const apiKey = process.env.CORE_PERSONA_ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  };
}

function hchatRequestSpec(): RequestSpec | null {
  const apiKey = process.env.H_CHAT_API_KEY;
  if (!apiKey) return null;
  const projectId = process.env.H_CHAT_API_PROJECT_ID;
  return {
    url: 'https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3/claude/messages',
    headers: {
      'content-type': 'application/json',
      Authorization: apiKey,
      ...(projectId ? { 'X-Project-Id': projectId } : {}),
    },
  };
}

function modelFor(provider: PersonaProvider): string {
  if (provider === 'hchat') {
    return process.env.H_CHAT_API_MODEL ?? 'claude-haiku-4-5';
  }
  return process.env.CORE_PERSONA_MODEL ?? 'claude-haiku-4-5';
}

/**
 * 현재 서버가 쓸 provider. **실제로 채워진 키를 보고 자동으로 고른다** — 예전엔
 * `CORE_PERSONA_PROVIDER` 수동 토글이 따로 있었는데, 그 값이 실제 채운 키와
 * 어긋나면(예: hchat 키만 채워놓고 토글은 `direct`로 남은 경우) 네트워크 호출
 * 자체를 안 하고 조용히 폴백 대사만 나가는 사고가 났다. 토글을 없애고 "키가
 * 있는 쪽을 쓴다"로 단순화해서 이 어긋남 자체가 불가능하게 한다.
 * direct(CORE_PERSONA_ANTHROPIC_API_KEY)를 hchat(H_CHAT_API_KEY)보다 우선한다.
 */
export function activePersonaProvider(): PersonaProvider {
  if (process.env.CORE_PERSONA_ANTHROPIC_API_KEY) return 'direct';
  if (process.env.H_CHAT_API_KEY) return 'hchat';
  return 'direct';
}

/** provider별 요청 스펙. 키가 없으면 null(호출부가 폴백으로 대체). */
function requestSpecFor(provider: PersonaProvider): RequestSpec | null {
  return provider === 'hchat' ? hchatRequestSpec() : directRequestSpec();
}

/** 한 번의 fetch. 실패(네트워크/타임아웃/비-2xx)하면 null. */
async function callOnce(
  spec: RequestSpec,
  provider: PersonaProvider,
  body: Record<string, unknown>,
): Promise<AnthropicResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`[corePersona] ${provider} 호출 실패: HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as AnthropicResponse;
  } catch (err) {
    console.error(`[corePersona] ${provider} 호출 오류:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 코어/티모시 대사 한 줄을 생성한다. 성공하면 텍스트, 실패(키 미설정/네트워크 오류/
 * 타임아웃/비-2xx/빈 응답)하면 `null`. `userPromptOrMessages`는 한 마디짜리 문자열
 * (기존 대부분의 트리거)이거나 여러 턴짜리 배열(대화 맥락이 있는 경우)이다.
 */
export async function generateCoreCommentary(
  provider: PersonaProvider,
  system: string,
  userPromptOrMessages: string | AnthropicMessage[],
): Promise<string | null> {
  const spec = requestSpecFor(provider);
  if (!spec) return null;

  const messages: AnthropicMessage[] =
    typeof userPromptOrMessages === 'string'
      ? [{ role: 'user', content: userPromptOrMessages }]
      : userPromptOrMessages;

  const data = await callOnce(spec, provider, {
    model: modelFor(provider),
    max_tokens: 200,
    stream: false,
    system,
    messages,
  });
  if (!data) return null;

  const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
  return text && text.length > 0 ? text : null;
}

/**
 * 도구 호출(tool use)을 포함한 에이전트 루프. 모델이 답하기 전에 실제 게임 상태를
 * 조회하고 싶어하면(`stop_reason === 'tool_use'`) 요청받은 도구를 `executeTool`로
 * 실행하고 그 결과를 `tool_result`로 돌려보낸 뒤 다시 묻는다 — 모델이 텍스트로
 * 답할 때까지, 또는 `MAX_TOOL_ITERATIONS`에 닿을 때까지 반복한다.
 *
 * 도구가 필요 없는 질문(예: "밥 먹었냐")이면 모델이 첫 응답에서 바로 텍스트로 답하므로
 * 이 경우 `generateCoreCommentary`와 왕복 횟수가 같다 — 도구 목록을 준다고 항상 더
 * 느려지는 건 아니다.
 */
export async function generateWithTools(
  provider: PersonaProvider,
  system: string,
  initialMessages: AnthropicMessage[],
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
): Promise<string | null> {
  const spec = requestSpecFor(provider);
  if (!spec) return null;

  const messages: LooseMessage[] = [...initialMessages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const data = await callOnce(spec, provider, {
      model: modelFor(provider),
      max_tokens: 300,
      stream: false,
      system,
      messages,
      tools,
    });
    if (!data) return null;

    const blocks = data.content ?? [];
    const toolUseBlocks = blocks.filter((block) => block.type === 'tool_use');

    if (data.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      const text = blocks.find((block) => block.type === 'text')?.text?.trim();
      return text && text.length > 0 ? text : null;
    }

    // 모델의 tool_use 턴을 그대로 이어붙이고, 도구를 실제로 실행한 결과를
    // tool_result로 돌려준다 — Anthropic 도구 사용 프로토콜의 왕복 형식이다.
    messages.push({ role: 'assistant', content: blocks });
    const resultBlocks: ContentBlock[] = [];
    for (const block of toolUseBlocks) {
      let result: unknown;
      try {
        result = await executeTool(block.name ?? '', block.input);
      } catch (err) {
        result = { error: String(err) };
      }
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: resultBlocks });
  }

  console.error(`[corePersona] ${provider} 도구 호출 루프가 ${MAX_TOOL_ITERATIONS}회를 넘었다`);
  return null;
}
