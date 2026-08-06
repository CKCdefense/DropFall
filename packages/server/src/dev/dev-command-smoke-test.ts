import { Client } from '@colyseus/sdk';
import type { GameRoomState } from '../schema/GameRoomState';
import type { DevResultMessage } from '@dropfall/shared';

/**
 * 개발 커맨드가 **서버를 거쳐** 도는지 확인한다.
 *
 * 로컬 모드는 월드를 직접 들고 있어서 잘 도는 게 당연하다 — 멀티플레이 경로는
 * 메시지 왕복과 개발 플래그 판정이 끼어드니 따로 확인해야 한다.
 *
 *   DROPFALL_DEV=1 pnpm dev:server        # 다른 터미널
 *   pnpm --filter @dropfall/server smoke:dev
 *
 * 플래그 없이 띄운 서버로 돌리면 응답이 아예 안 와야 정상이다(치트가 막혔다는 뜻).
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:2567';
/** 개발 플래그가 꺼진 서버는 응답 자체를 안 준다 — 그 경우를 구분하려고 짧게 기다린다. */
const REPLY_TIMEOUT_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const client = new Client(SERVER_URL);
  console.log(`[dev-smoke] connecting to ${SERVER_URL} ...`);

  const room = await client.joinOrCreate<GameRoomState>('game', {
    nickname: '개발',
    roomName: '개발 커맨드 테스트',
  });
  console.log(`[dev-smoke] joined "${room.roomId}" as "${room.sessionId}"`);

  const replies: DevResultMessage[] = [];
  room.onMessage('devResult', (result: DevResultMessage) => {
    replies.push(result);
    console.log(`[dev-smoke] ← ${result.ok ? 'ok ' : 'err'} ${result.message.split('\n')[0]}`);
  });

  // 대기실을 건너뛰고 바로 커맨드를 던진다 — 개발 커맨드는 페이즈와 무관하게 동작한다.
  for (const line of ['help', 'give rifle 1', 'money 500', 'nonsense']) {
    console.log(`[dev-smoke] → ${line}`);
    room.send('dev', { line });
    await wait(250);
  }

  await wait(REPLY_TIMEOUT_MS);
  await room.leave();

  if (replies.length === 0) {
    console.log('[dev-smoke] 응답 없음 — 서버가 개발 모드가 아니다(DROPFALL_DEV=1 필요).');
    process.exit(1);
  }

  const failed = replies.filter((reply) => !reply.ok);
  console.log(`[dev-smoke] 응답 ${replies.length}건 (실패 ${failed.length}건)`);
  // 'nonsense' 하나는 실패가 정상이다. 그 외가 실패면 문제다.
  if (failed.length !== 1) {
    console.error('[dev-smoke] 예상과 다르다 — 실패해야 할 명령은 nonsense 하나뿐이다.');
    process.exit(1);
  }
  console.log('[dev-smoke] 통과');
  process.exit(0);
}

main().catch((error) => {
  console.error('[dev-smoke] 실패:', error);
  process.exit(1);
});
