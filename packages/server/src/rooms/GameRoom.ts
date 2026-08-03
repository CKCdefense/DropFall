import { Client, Room, ServerError, matchMaker } from 'colyseus';
import {
  LOBBY_ERROR_MESSAGE,
  LobbyMessage,
  MAX_CLIENTS_PER_ROOM,
  PATCH_RATE,
  RoomErrorCode,
  RoomPhase,
  StartRejectReason,
  TICK_RATE,
  World,
  generateRoomCode,
  isJobId,
  sanitizeNickname,
  sanitizePassword,
  sanitizeRoomName,
  type CreateRoomOptions,
  type JoinRoomOptions,
  type PlayerInputMessage,
  type SelectJobMessage,
  type SetReadyMessage,
} from '@dropfall/shared';
import { GameRoomState, PlayerSchema } from '../schema/GameRoomState';

/** 방 코드 중복 시 재시도 횟수. 31^4 ≈ 92만 조합이라 실제로는 첫 시도에 끝난다. */
const ROOM_CODE_MAX_ATTEMPTS = 10;

/** 코어 주변 스폰 반경(px). 밸런스 확정 전까지 임의값. */
const SPAWN_RADIUS = 40;

async function allocateRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < ROOM_CODE_MAX_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode();
    const existing = await matchMaker.getRoomById(code);
    if (!existing) return code;
  }
  // 여기까지 오면 코드 공간이 사실상 소진된 상황 — 데모 규모에서는 일어나지 않는다.
  throw new ServerError(500, '방 코드를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

export class GameRoom extends Room {
  maxClients = MAX_CLIENTS_PER_ROOM;
  state = new GameRoomState();

  private world = new World();
  /** 평문 보관. 게임 방 비밀번호는 계정 자격증명이 아니라 입장 키라 해싱하지 않는다. */
  private password = '';

  messages = {
    input: (client: Client, payload: PlayerInputMessage) => {
      this.world.setInput(client.sessionId, payload);
    },

    // 대기실 메시지. 클라이언트 입력은 신뢰하지 않는다 — 값과 권한을 모두 여기서 검증한다.
    [LobbyMessage.SELECT_JOB]: (client: Client, payload: SelectJobMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== RoomPhase.LOBBY) return;
      if (!isJobId(payload?.job)) return;

      player.job = payload.job;
      // 직업을 바꾸면 준비를 푼다 — 준비한 채로 바꾸면 팀 구성이 조용히 달라진다.
      player.isReady = false;
    },

    [LobbyMessage.SET_READY]: (client: Client, payload: SetReadyMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== RoomPhase.LOBBY) return;
      if (typeof payload?.ready !== 'boolean') return;
      // 직업 없이 준비할 수는 없다
      if (payload.ready && !isJobId(player.job)) return;

      player.isReady = payload.ready;
    },

    [LobbyMessage.START_GAME]: (client: Client) => {
      const reason = this.getStartRejection(client.sessionId);
      if (reason) {
        client.send(LOBBY_ERROR_MESSAGE, reason);
        return;
      }
      this.startGame();
    },
  };

  async onCreate(options: CreateRoomOptions): Promise<void> {
    const roomName = sanitizeRoomName(options?.roomName);
    if (!roomName) {
      throw new ServerError(
        RoomErrorCode.INVALID_ROOM_NAME,
        '방 이름은 1~16자로 입력해 주세요.',
      );
    }

    this.password = sanitizePassword(options?.password);

    // roomId를 사람이 읽을 수 있는 4자리 코드로 교체한다(onCreate에서만 허용된다).
    // 이렇게 해두면 "목록에서 선택"과 "코드 직접 입력"이 모두 joinById로 통일된다.
    this.roomId = await allocateRoomCode();

    this.state.roomCode = this.roomId;
    this.state.roomName = roomName;
    this.state.hasPassword = this.password.length > 0;

    // GET /rooms(방 목록)가 읽는 값. 비밀번호 자체는 절대 넣지 않는다.
    await this.setMetadata({
      roomName,
      hasPassword: this.state.hasPassword,
    });

    // Colyseus는 시뮬레이션 틱과 상태 전송 주기가 별개다. patchRate를 명시하지 않으면
    // 기본값 20Hz로 남아서, 서버를 60Hz로 돌려도 클라이언트는 20Hz로만 본다.
    this.patchRate = 1000 / PATCH_RATE;
    this.setSimulationInterval(() => this.update(), 1000 / TICK_RATE);
  }

  /**
   * 입장 검증은 전부 여기서 끝낸다. onJoin에서 던지면 이미 좌석이 예약된 뒤라
   * 정리가 지저분해진다.
   */
  onAuth(_client: Client, options: JoinRoomOptions): { nickname: string } {
    const nickname = sanitizeNickname(options?.nickname);
    if (!nickname) {
      throw new ServerError(RoomErrorCode.INVALID_NICKNAME, '닉네임은 1~12자로 입력해 주세요.');
    }

    if (this.password.length > 0 && sanitizePassword(options?.password) !== this.password) {
      throw new ServerError(RoomErrorCode.INVALID_PASSWORD, '비밀번호가 올바르지 않습니다.');
    }

    return { nickname };
  }

  onJoin(client: Client, _options: JoinRoomOptions, auth: { nickname: string }): void {
    const player = new PlayerSchema();
    player.nickname = auth.nickname;

    // 코어 주변에 원형으로 흩어 놓는다. 전원 (0,0)에 겹쳐 스폰되면 서로 안 보인다.
    const index = this.state.players.size;
    const angle = (index / MAX_CLIENTS_PER_ROOM) * Math.PI * 2;
    this.world.addPlayer(
      client.sessionId,
      Math.cos(angle) * SPAWN_RADIUS,
      Math.sin(angle) * SPAWN_RADIUS,
    );
    this.state.players.set(client.sessionId, player);

    // 첫 입장자가 방장이 된다.
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;

    console.log(`[GameRoom ${this.roomId}] "${auth.nickname}"(${client.sessionId}) joined`);
  }

  onLeave(client: Client): void {
    this.world.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);

    // 방장이 나가면 남은 사람 중 첫 번째에게 넘긴다. 아무도 없으면 비워둔다.
    if (this.state.hostSessionId === client.sessionId) {
      this.state.hostSessionId = this.state.players.keys().next().value ?? '';
    }

    console.log(`[GameRoom ${this.roomId}] ${client.sessionId} left`);
  }

  /** 시작할 수 없으면 사유 문자열, 가능하면 null */
  private getStartRejection(sessionId: string): string | null {
    if (this.state.phase !== RoomPhase.LOBBY) return StartRejectReason.ALREADY_STARTED;
    if (sessionId !== this.state.hostSessionId) return StartRejectReason.NOT_HOST;

    for (const [id, player] of this.state.players) {
      if (!isJobId(player.job)) return StartRejectReason.NO_JOB;
      // 방장은 자기 준비 버튼 대신 시작 버튼을 쓰므로 준비 상태를 요구하지 않는다.
      if (id !== this.state.hostSessionId && !player.isReady) {
        return StartRejectReason.NOT_ALL_READY;
      }
    }

    return null;
  }

  private startGame(): void {
    this.state.phase = RoomPhase.PLAYING;
    // 시작 후 들어오는 사람이 대기실 상태를 보지 않도록 잠근다.
    void this.lock();
    console.log(`[GameRoom ${this.roomId}] game started (${this.state.players.size} players)`);
  }

  private update(): void {
    // 대기실에서는 시뮬레이션을 돌리지 않는다.
    if (this.state.phase !== RoomPhase.PLAYING) return;

    this.world.tick(1 / TICK_RATE);

    for (const [id, player] of this.world.getPlayers()) {
      const schema = this.state.players.get(id);
      if (!schema) continue;
      schema.x = player.x;
      schema.y = player.y;
      schema.aimAngle = player.aimAngle;
      schema.lastProcessedSeq = player.lastProcessedSeq;
    }
  }
}
