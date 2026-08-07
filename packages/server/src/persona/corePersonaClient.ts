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

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequestSpec {
  url: string;
  headers: Record<string, string>;
}

function directRequestSpec(): RequestSpec | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
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

/** 현재 서버가 쓸 provider. `direct`가 기본값 — 명시적으로 `hchat`을 켜야 그쪽을 탄다. */
export function activePersonaProvider(): PersonaProvider {
  return process.env.CORE_PERSONA_PROVIDER === 'hchat' ? 'hchat' : 'direct';
}

/**
 * 코어 대사 한 줄을 생성한다. 성공하면 텍스트, 실패(키 미설정/네트워크 오류/타임아웃/
 * 비-2xx/빈 응답)하면 `null`.
 */
export async function generateCoreCommentary(
  provider: PersonaProvider,
  system: string,
  userPrompt: string,
): Promise<string | null> {
  const spec = provider === 'hchat' ? hchatRequestSpec() : directRequestSpec();
  if (!spec) return null;

  const messages: AnthropicMessage[] = [{ role: 'user', content: userPrompt }];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: modelFor(provider),
        max_tokens: 200,
        stream: false,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      console.error(`[corePersona] ${provider} 호출 실패: HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error(`[corePersona] ${provider} 호출 오류:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
