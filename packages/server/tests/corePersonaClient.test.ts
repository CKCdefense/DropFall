import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activePersonaProvider,
  generateCoreCommentary,
  generateWithTools,
  type ToolDefinition,
} from '../src/persona/corePersonaClient';

/**
 * corePersonaClient는 실제 네트워크 호출을 하는 모듈이라, 여기서는 `fetch`를
 * mock으로 갈아끼워서 프로토콜(요청 헤더/바디, 도구 왕복, 에러 처리)만 빠르게
 * 검증한다. "실제 hchat이 진짜 이렇게 답하는가"는 tests/persona-integration.test.ts
 * (과금되는 통합 테스트, test:integration)의 몫이다.
 */

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

/** callOnce()가 기대하는 최소한의 fetch Response 모양. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function requestBodyOf(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[callIndex]![1].body as string) as Record<string, unknown>;
}

interface ToolResultBlock {
  type: string;
  tool_use_id: string;
  content: string;
}

/** generateWithTools가 도구 결과를 되돌려보낼 때 붙이는 마지막 user 메시지의 tool_result 블록. */
function lastToolResultOf(body: Record<string, unknown>): { role: string; block: ToolResultBlock } {
  const messages = body.messages as { role: string; content: ToolResultBlock[] }[];
  const last = messages.at(-1)!;
  return { role: last.role, block: last.content[0]! };
}

afterEach(() => {
  resetEnv();
  vi.unstubAllGlobals();
});

describe('activePersonaProvider — 키 존재 여부로 자동 선택', () => {
  it('CORE_PERSONA_ANTHROPIC_API_KEY가 있으면 direct', () => {
    process.env.CORE_PERSONA_ANTHROPIC_API_KEY = 'key';
    delete process.env.H_CHAT_API_KEY;
    expect(activePersonaProvider()).toBe('direct');
  });

  it('그 키가 없고 H_CHAT_API_KEY만 있으면 hchat', () => {
    delete process.env.CORE_PERSONA_ANTHROPIC_API_KEY;
    process.env.H_CHAT_API_KEY = 'key';
    expect(activePersonaProvider()).toBe('hchat');
  });

  it('둘 다 있으면 direct가 우선한다', () => {
    process.env.CORE_PERSONA_ANTHROPIC_API_KEY = 'a';
    process.env.H_CHAT_API_KEY = 'b';
    expect(activePersonaProvider()).toBe('direct');
  });

  it('둘 다 없으면 direct(호출은 스펙 없음으로 어차피 null 처리된다)', () => {
    delete process.env.CORE_PERSONA_ANTHROPIC_API_KEY;
    delete process.env.H_CHAT_API_KEY;
    expect(activePersonaProvider()).toBe('direct');
  });
});

describe('generateCoreCommentary', () => {
  beforeEach(() => {
    process.env.CORE_PERSONA_ANTHROPIC_API_KEY = 'test-key';
  });

  it('키가 없으면 fetch도 안 하고 null', async () => {
    delete process.env.CORE_PERSONA_ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('성공하면 text 블록을 trim해서 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '  안녕  ' }] })));
    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBe('안녕');
  });

  it('비-2xx 응답이면 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBeNull();
  });

  it('fetch 자체가 던지면(네트워크 오류/타임아웃) null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBeNull();
  });

  it('text 블록이 공백뿐이면 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '   ' }] })));
    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBeNull();
  });

  it('text 블록 자체가 없으면(도구 블록만 있는 등) null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'tool_use' }] })));
    expect(await generateCoreCommentary('direct', 'sys', 'hello')).toBeNull();
  });

  it('문자열 대신 메시지 배열을 줘도 그대로 body.messages에 실린다(대화 맥락)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '답' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await generateCoreCommentary('direct', 'sys', [
      { role: 'user', content: '이전 질문' },
      { role: 'assistant', content: '이전 답' },
      { role: 'user', content: '새 질문' },
    ]);

    expect(requestBodyOf(fetchMock).messages).toHaveLength(3);
  });

  it('direct는 x-api-key + anthropic-version 헤더를 쓴다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '답' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await generateCoreCommentary('direct', 'sys', 'hello');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('api.anthropic.com');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('hchat은 Authorization 헤더를 쓰고 anthropic-version이 없다', async () => {
    resetEnv();
    process.env.H_CHAT_API_KEY = 'hchat-key';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '답' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await generateCoreCommentary('hchat', 'sys', 'hello');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('hchat-in');
    expect(init.headers.Authorization).toBe('hchat-key');
    expect(init.headers['anthropic-version']).toBeUndefined();
  });

  it('hchat 키가 없으면 hchat provider로 불러도 null(direct 키가 있어도 안 섞인다)', async () => {
    // CORE_PERSONA_ANTHROPIC_API_KEY는 beforeEach에서 채워져 있지만, provider를
    // 명시적으로 'hchat'으로 부르면 그쪽 키가 없는 한 실패해야 한다 — 두 provider가
    // 서로의 키를 대신 쓰면 안 된다.
    delete process.env.H_CHAT_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await generateCoreCommentary('hchat', 'sys', 'hello')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('generateWithTools — 도구 사용 에이전트 루프', () => {
  const TOOLS: ToolDefinition[] = [{ name: 'get_thing', description: 'd', input_schema: {} }];

  beforeEach(() => {
    process.env.CORE_PERSONA_ANTHROPIC_API_KEY = 'test-key';
  });

  it('도구가 필요 없으면 첫 응답에서 바로 텍스트를 돌려준다(fetch 1회, 도구 미실행)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '그냥 답' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn();

    const result = await generateWithTools('direct', 'sys', [{ role: 'user', content: 'hi' }], TOOLS, executeTool);

    expect(result).toBe('그냥 답');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    // 도구 목록도 요청 바디에 실려 나가야 모델이 존재를 알 수 있다.
    expect(requestBodyOf(fetchMock).tools).toEqual(TOOLS);
  });

  it('도구 호출 → 결과 반영 → 최종 텍스트까지 왕복한다(fetch 2회)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'call1', name: 'get_thing', input: { x: 1 } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '조회했더니 42' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({ value: 42 });

    const result = await generateWithTools(
      'direct',
      'sys',
      [{ role: 'user', content: '몇 개야?' }],
      TOOLS,
      executeTool,
    );

    expect(result).toBe('조회했더니 42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledWith('get_thing', { x: 1 });

    const { role, block } = lastToolResultOf(requestBodyOf(fetchMock, 1));
    expect(role).toBe('user');
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('call1');
    expect(JSON.parse(block.content)).toEqual({ value: 42 });
  });

  it('도구 실행이 실패해도(예외) 루프가 죽지 않고 에러를 결과로 담아 계속한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'call1', name: 'get_thing', input: {} }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '괜찮아' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await generateWithTools('direct', 'sys', [{ role: 'user', content: 'q' }], TOOLS, executeTool);

    expect(result).toBe('괜찮아');
    const { block } = lastToolResultOf(requestBodyOf(fetchMock, 1));
    expect(JSON.parse(block.content).error).toContain('boom');
  });

  it('모델이 계속 도구만 요청하면 상한 횟수 후 null을 반환한다(무한루프 방지)', async () => {
    const alwaysToolUse = jsonResponse({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'call', name: 'get_thing', input: {} }],
    });
    const fetchMock = vi.fn().mockResolvedValue(alwaysToolUse);
    vi.stubGlobal('fetch', fetchMock);
    const executeTool = vi.fn().mockResolvedValue({});

    const result = await generateWithTools('direct', 'sys', [{ role: 'user', content: 'q' }], TOOLS, executeTool);

    expect(result).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('키가 없으면 fetch도 안 하고 null', async () => {
    delete process.env.CORE_PERSONA_ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithTools('direct', 'sys', [{ role: 'user', content: 'q' }], TOOLS, vi.fn());

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('중간 응답이 비-2xx면 그 자리에서 null(재시도 없음)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'call1', name: 'get_thing', input: {} }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateWithTools(
      'direct',
      'sys',
      [{ role: 'user', content: 'q' }],
      TOOLS,
      vi.fn().mockResolvedValue({}),
    );

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
