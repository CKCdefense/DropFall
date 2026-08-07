import { Client } from '@colyseus/sdk';
import {
  EXPLORED_BYTE_COUNT,
  ExploredMap,
  LobbyMessage,
  RoomPhase,
  worldToCell,
  type PlayerInputMessage,
} from '@dropfall/shared';
import type { GameRoomState } from '../schema/GameRoomState';

/**
 * 탐색 안개가 **서버를 거쳐 팀 전체에 공유되는지** 확인한다.
 *
 * 두 클라이언트를 같은 방에 붙이고 한쪽만 멀리 걸어가게 한 뒤, 걷지 않은 쪽의
 * 상태에도 그 지역이 밝혀져 있는지 본다 — 로컬 모드에서는 확인할 수 없는 부분이다.
 *
 *   DROPFALL_DEV=1 pnpm dev:server
 *   pnpm --filter @dropfall/server smoke:fog
 */

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:2567';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countBits(bytes: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < EXPLORED_BYTE_COUNT; i += 1) {
    let byte = bytes[i] ?? 0;
    while (byte) {
      total += byte & 1;
      byte >>= 1;
    }
  }
  return total;
}

async function main(): Promise<void> {
  const client = new Client(SERVER_URL);
  console.log(`[fog-smoke] connecting to ${SERVER_URL} ...`);

  const scout = await client.joinOrCreate<GameRoomState>('game', {
    nickname: '정찰',
    roomName: '안개 테스트',
  });
  const watcher = await client.joinById<GameRoomState>(scout.roomId, { nickname: '관측' });
  console.log(`[fog-smoke] joined "${scout.roomId}" — 정찰 ${scout.sessionId} / 관측 ${watcher.sessionId}`);

  // 로비를 통과해야 월드가 돈다 — 둘 다 직업을 고르고 준비하면 방장이 시작한다.
  for (const [room, job] of [[scout, 'soldier'], [watcher, 'medic']] as const) {
    room.send(LobbyMessage.SELECT_JOB, { job });
    await wait(100);
    room.send(LobbyMessage.SET_READY, { ready: true });
    await wait(100);
  }
  scout.send(LobbyMessage.START_GAME, {});

  for (let i = 0; i < 40 && scout.state.phase !== RoomPhase.PLAYING; i += 1) await wait(100);
  if (scout.state.phase !== RoomPhase.PLAYING) {
    console.error('[fog-smoke] 실패: 게임이 시작되지 않았다(phase=' + scout.state.phase + ')');
    process.exit(1);
  }
  console.log('[fog-smoke] 게임 시작됨');

  await wait(500);
  const before = countBits(watcher.state.explored);
  console.log(`[fog-smoke] 시작: 관측자가 보는 밝혀진 칸 ${before}`);

  // 정찰자만 한 방향으로 계속 걷는다.
  let seq = 0;
  for (let i = 0; i < 60; i += 1) {
    const input: PlayerInputMessage = { seq: (seq += 1), moveX: 1, moveY: 0, aimAngle: 0 };
    scout.send('input', input);
    await wait(50);
  }
  await wait(600);

  const after = countBits(watcher.state.explored);
  const scoutPlayer = scout.state.players.get(scout.sessionId);
  console.log(`[fog-smoke] 정찰 후: 관측자가 보는 밝혀진 칸 ${after} (정찰자 x=${Math.round(scoutPlayer?.x ?? 0)})`);

  // 정찰자가 실제로 간 자리가 관측자 쪽에도 밝혀져 있어야 한다.
  const map = new ExploredMap();
  map.load(watcher.state.explored);
  const cell = worldToCell(scoutPlayer?.x ?? 0, scoutPlayer?.y ?? 0);
  const sharedHere = map.isExplored(cell.cx, cell.cy);

  await scout.leave();
  await watcher.leave();

  if (after <= before) {
    console.error('[fog-smoke] 실패: 정찰했는데 관측자 쪽 안개가 그대로다.');
    process.exit(1);
  }
  if (!sharedHere) {
    console.error('[fog-smoke] 실패: 정찰자가 선 자리가 관측자 쪽에 안 밝혀졌다.');
    process.exit(1);
  }
  console.log(`[fog-smoke] 통과 — 팀 공유 확인(+${after - before}칸)`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[fog-smoke] 실패:', error);
  process.exit(1);
});
