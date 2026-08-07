import { Client } from '@colyseus/sdk';
import {
  ROOM_CODE_LENGTH,
  RoomErrorCode,
  isValidRoomCode,
  type CreateRoomOptions,
  type JoinRoomOptions,
  type RoomListItem,
} from '@dropfall/shared';

/**
 * 로비 흐름(방 생성 / 목록 / 코드 참여 / 비밀번호 검증) 실동작 검증.
 * 서버를 띄운 뒤 `pnpm --filter @dropfall/server smoke:lobby` 로 실행한다.
 */
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:2567';

interface RemoteState {
  roomCode: string;
  roomName: string;
  hasPassword: boolean;
  players: { size: number; forEach(cb: (v: { nickname: string }, k: string) => void): void };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const client = new Client(SERVER_URL);
  const password = 'hunter2';

  // 1) 비밀번호가 걸린 방 생성 — roomId가 사람이 읽는 4자리 코드로 바뀌어야 한다.
  const host = await client.create<RemoteState>('game', {
    nickname: '호스트',
    roomName: '테스트 거점',
    password,
  } satisfies CreateRoomOptions);

  const roomCode = host.roomId;
  console.log(`[lobby] 방 생성됨: code=${roomCode}`);
  assert(
    isValidRoomCode(roomCode),
    `roomId가 ${ROOM_CODE_LENGTH}자리 방 코드가 아니다: "${roomCode}"`,
  );

  await wait(300);
  assert(host.state.roomName === '테스트 거점', '방 이름이 상태에 반영되지 않았다');
  assert(host.state.hasPassword === true, 'hasPassword가 상태에 반영되지 않았다');

  // 2) 방 목록에 뜨는지 + 비밀번호가 새어나가지 않는지
  const response = await fetch(`${SERVER_URL}/rooms`);
  const rooms = (await response.json()) as RoomListItem[];
  const listed = rooms.find((room) => room.roomCode === roomCode);
  assert(listed, 'GET /rooms 목록에 방이 없다');
  assert(listed.hasPassword === true, '목록의 hasPassword가 틀렸다');
  assert(listed.clients === 1, `목록의 인원수가 틀렸다: ${listed.clients}`);
  assert(
    !JSON.stringify(listed).includes(password),
    '방 목록 응답에 비밀번호가 노출됐다',
  );
  console.log(`[lobby] 목록 확인: ${listed.roomName} ${listed.clients}/${listed.maxClients}`);

  // 3) 틀린 비밀번호는 거절돼야 한다
  let rejected = false;
  try {
    await client.joinById<RemoteState>(roomCode, {
      nickname: '침입자',
      password: 'wrong',
    } satisfies JoinRoomOptions);
  } catch (err) {
    rejected = true;
    const code = (err as { code?: number }).code;
    assert(
      code === RoomErrorCode.INVALID_PASSWORD,
      `기대한 INVALID_PASSWORD가 아니다: code=${code}`,
    );
    console.log('[lobby] 틀린 비밀번호 거절됨 (기대한 동작)');
  }
  assert(rejected, '틀린 비밀번호인데 입장에 성공했다');

  // 4) 빈 닉네임도 거절돼야 한다
  let nicknameRejected = false;
  try {
    await client.joinById<RemoteState>(roomCode, { nickname: '   ', password });
  } catch (err) {
    nicknameRejected = true;
    assert(
      (err as { code?: number }).code === RoomErrorCode.INVALID_NICKNAME,
      '기대한 INVALID_NICKNAME이 아니다',
    );
    console.log('[lobby] 빈 닉네임 거절됨 (기대한 동작)');
  }
  assert(nicknameRejected, '빈 닉네임인데 입장에 성공했다');

  // 5) 올바른 비밀번호 + 방 코드로 참여
  const guest = await client.joinById<RemoteState>(roomCode, {
    nickname: '게스트',
    password,
  } satisfies JoinRoomOptions);
  console.log(`[lobby] 코드로 참여 성공: sessionId=${guest.sessionId}`);

  await wait(500);
  const nicknames: string[] = [];
  guest.state.players.forEach((player) => nicknames.push(player.nickname));
  assert(guest.state.players.size === 2, `인원이 2명이 아니다: ${guest.state.players.size}`);
  assert(nicknames.includes('호스트'), '호스트 닉네임이 동기화되지 않았다');
  assert(nicknames.includes('게스트'), '게스트 닉네임이 동기화되지 않았다');
  console.log(`[lobby] 닉네임 동기화 확인: ${nicknames.join(', ')}`);

  await guest.leave();
  await host.leave();
  console.log('[lobby] OK — 방 생성, 코드 발급, 목록 노출, 비밀번호/닉네임 검증, 참여까지 확인됨');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[lobby] FAILED:', err);
    process.exit(1);
  });
