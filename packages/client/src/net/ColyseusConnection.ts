import { Client, type Room } from '@colyseus/sdk';
import type {
  CreateRoomOptions,
  JoinRoomOptions,
  PlayerInputMessage,
} from '@dropfall/shared';
import { RoomErrorCode, normalizeRoomCode } from '@dropfall/shared';
import { SERVER_HTTP_URL } from './config';
import type { GameConnection, RoomInfo, WorldSnapshot } from './GameConnection';

/** 서버 Schema를 클라이언트 관점에서 본 모양. 서버의 GameRoomState와 1:1로 맞춘다. */
interface RemotePlayerState {
  nickname: string;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
}

interface RemoteGameState {
  roomCode: string;
  roomName: string;
  hasPassword: boolean;
  players: {
    size: number;
    forEach(callback: (value: RemotePlayerState, key: string) => void): void;
  };
}

type GameRoom = Room<unknown, RemoteGameState>;

const client = new Client(SERVER_HTTP_URL);

/** 사용자에게 그대로 보여줄 수 있는 메시지로 변환한다. */
export class JoinError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'JoinError';
  }
}

function toJoinError(err: unknown): JoinError {
  const code = (err as { code?: number })?.code;
  const message = (err as { message?: string })?.message;

  switch (code) {
    case RoomErrorCode.INVALID_PASSWORD:
      return new JoinError('비밀번호가 올바르지 않습니다.', code);
    case RoomErrorCode.INVALID_NICKNAME:
      return new JoinError('닉네임은 1~12자로 입력해 주세요.', code);
    case RoomErrorCode.INVALID_ROOM_NAME:
      return new JoinError('방 이름은 1~16자로 입력해 주세요.', code);
    case 4212: // Colyseus: room not found / seat reservation expired
      return new JoinError('방을 찾을 수 없습니다. 코드를 다시 확인해 주세요.', code);
    default:
      return new JoinError(message || '서버에 연결하지 못했습니다.', code);
  }
}

export async function createRoom(options: CreateRoomOptions): Promise<ColyseusConnection> {
  try {
    const room = await client.create<RemoteGameState>('game', options);
    return new ColyseusConnection(room);
  } catch (err) {
    throw toJoinError(err);
  }
}

export async function joinRoomByCode(
  roomCode: string,
  options: JoinRoomOptions,
): Promise<ColyseusConnection> {
  try {
    // 방 코드가 곧 roomId다 — 목록에서 고르든 직접 입력하든 같은 경로를 탄다.
    const room = await client.joinById<RemoteGameState>(normalizeRoomCode(roomCode), options);
    return new ColyseusConnection(room);
  } catch (err) {
    throw toJoinError(err);
  }
}

export class ColyseusConnection implements GameConnection {
  readonly isLocal = false;

  /** 매 프레임 새 배열을 만들지 않도록 버퍼를 재사용한다. */
  private readonly snapshot: WorldSnapshot = { players: [] };
  private latestPing = 0;

  constructor(private readonly room: GameRoom) {
    this.room.ping((ms) => {
      this.latestPing = ms;
    });
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get roomInfo(): RoomInfo {
    return {
      roomCode: this.room.state?.roomCode || this.room.roomId,
      roomName: this.room.state?.roomName || '',
      hasPassword: Boolean(this.room.state?.hasPassword),
    };
  }

  get ping(): number {
    return this.latestPing;
  }

  sendInput(input: PlayerInputMessage): void {
    this.room.send('input', input);
  }

  getSnapshot(): WorldSnapshot {
    const players = this.snapshot.players;
    players.length = 0;

    const state = this.room.state;
    if (!state?.players) return this.snapshot;

    state.players.forEach((player, id) => {
      players.push({
        id,
        nickname: player.nickname,
        x: player.x,
        y: player.y,
        aimAngle: player.aimAngle,
        lastProcessedSeq: player.lastProcessedSeq,
      });
    });

    return this.snapshot;
  }

  onDisconnect(callback: (reason: string) => void): void {
    this.room.onLeave((code, reason) => {
      // 1000 = 정상 종료(내가 leave를 호출한 경우)
      if (code === 1000) return;
      callback(reason || `서버와의 연결이 끊어졌습니다. (code ${code})`);
    });
    this.room.onError((code, message) => {
      callback(message || `서버 오류가 발생했습니다. (code ${code})`);
    });
  }

  async leave(): Promise<void> {
    await this.room.leave(true);
  }
}
