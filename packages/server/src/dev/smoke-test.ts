import { Callbacks, Client } from '@colyseus/sdk';
import type { GameRoomState, PlayerSchema } from '../schema/GameRoomState';
import type { PlayerInputMessage } from '@dropfall/shared';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:2567';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const client = new Client(SERVER_URL);

  console.log(`[smoke-test] connecting to ${SERVER_URL} ...`);
  const room = await client.joinOrCreate<GameRoomState>('game', {
    nickname: '스모크',
    roomName: '스모크 테스트',
  });
  console.log(`[smoke-test] joined room "${room.roomId}" as "${room.sessionId}"`);

  const callbacks = Callbacks.get(room);

  const player = await new Promise<PlayerSchema>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('players 상태 동기화 타임아웃 (3s)')), 3000);
    callbacks.onAdd('players', (p: PlayerSchema, sessionId: string) => {
      if (sessionId !== room.sessionId) return;
      clearTimeout(timeout);
      resolve(p);
    });
  });

  console.log(`[smoke-test] initial state: x=${player.x} y=${player.y}`);

  // 1) 정상 입력 → 실제로 이동하는지
  room.send('input', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });
  await wait(500);
  console.log(`[smoke-test] after input+500ms: x=${player.x} y=${player.y} seq=${player.lastProcessedSeq}`);
  if (player.x <= 0) {
    throw new Error('입력을 보냈는데 서버가 x좌표를 갱신하지 않았다 (동기화 실패)');
  }

  // 2) 정지 입력 → 위치를 고정시켜서 이후 비교 기준을 만든다
  room.send('input', { seq: 2, moveX: 0, moveY: 0, aimAngle: 0 });
  await wait(300);
  const xAfterStop = player.x;
  console.log(`[smoke-test] after stop input: x=${xAfterStop}`);

  // 3) 필드 누락/잘못된 타입의 입력 — Playground에서 손으로 메시지를 보낼 때 실제로
  //    NaN 오염(PlayerSchema#x/y)이 발생했던 상황을 재현. 실제 네트워크에서는 클라이언트가
  //    타입을 지킨다는 보장이 없으므로 여기서만 의도적으로 타입을 어긴다.
  //    서버가 통째로 무시해야 한다.
  room.send('input', {} as unknown as PlayerInputMessage);
  room.send('input', { seq: 3, moveX: 'not-a-number', moveY: 0, aimAngle: 0 } as unknown as PlayerInputMessage);
  await wait(300);

  console.log(`[smoke-test] after malformed input: x=${player.x} y=${player.y}`);
  if (Number.isNaN(player.x) || Number.isNaN(player.y)) {
    throw new Error('잘못된 입력이 x/y를 NaN으로 오염시켰다');
  }
  if (player.x !== xAfterStop) {
    throw new Error('잘못된 입력인데도 위치가 바뀌었다 (검증이 안 먹힘)');
  }

  await room.leave();
  console.log('[smoke-test] OK — 연결, join, 입력 전송, 상태 동기화, 잘못된 입력 방어까지 전부 확인됨');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[smoke-test] FAILED:', err);
    process.exit(1);
  });
