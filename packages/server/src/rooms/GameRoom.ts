import { Client, Room, ServerError, matchMaker } from 'colyseus';
import {
  MAX_CLIENTS_PER_ROOM,
  RoomErrorCode,
  TICK_RATE,
  World,
  generateRoomCode,
  sanitizeNickname,
  sanitizePassword,
  sanitizeRoomName,
  type CreateRoomOptions,
  type FireInputMessage,
  type JoinRoomOptions,
  type PlayerInputMessage,
} from '@dropfall/shared';
import {
  GameRoomState,
  MonsterSchema,
  PlayerSchema,
  ProjectileSchema,
} from '../schema/GameRoomState';

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
    fire: (client: Client, payload: FireInputMessage) => {
      this.world.fireWeapon(client.sessionId, payload?.weaponId);
    },
    skipVote: (client: Client) => {
      this.world.castSkipVote(client.sessionId);
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

    console.log(`[GameRoom ${this.roomId}] "${auth.nickname}"(${client.sessionId}) joined`);
  }

  onLeave(client: Client): void {
    this.world.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);

    console.log(`[GameRoom ${this.roomId}] ${client.sessionId} left`);
  }

  private update(): void {
    this.world.tick(1 / TICK_RATE);

    for (const [id, player] of this.world.getPlayers()) {
      const schema = this.state.players.get(id);
      if (!schema) continue;
      schema.x = player.x;
      schema.y = player.y;
      schema.aimAngle = player.aimAngle;
      schema.lastProcessedSeq = player.lastProcessedSeq;
      schema.hp = player.hp;
    }

    this.syncMonsters();
    this.syncProjectiles();

    const core = this.world.getCore();
    this.state.coreHp = core.hp;
    this.state.coreMaxHp = core.maxHp;
    this.state.wavePhase = this.world.getWavePhase();
    this.state.currentWave = this.world.getCurrentWave();
    this.state.skipVoteCount = this.world.getSkipVoteCount();
  }

  /** 몬스터는 스폰/처치로 매 틱 등장·소멸하므로, world와 schema를 매번 대조해 맞춘다. */
  private syncMonsters(): void {
    const monsters = this.world.getMonsters();
    const aliveIds = new Set(monsters.keys());

    for (const [id, monster] of monsters) {
      let schema = this.state.monsters.get(id);
      if (!schema) {
        schema = new MonsterSchema();
        schema.type = monster.type;
        schema.maxHp = monster.maxHp;
        this.state.monsters.set(id, schema);
      }
      schema.x = monster.x;
      schema.y = monster.y;
      schema.hp = monster.hp;
    }

    for (const id of [...this.state.monsters.keys()]) {
      if (!aliveIds.has(id)) this.state.monsters.delete(id);
    }
  }

  /** 투사체도 몬스터와 동일하게 매 틱 등장·소멸한다. */
  private syncProjectiles(): void {
    const projectiles = this.world.getProjectiles();
    const aliveIds = new Set(projectiles.keys());

    for (const [id, projectile] of projectiles) {
      let schema = this.state.projectiles.get(id);
      if (!schema) {
        schema = new ProjectileSchema();
        this.state.projectiles.set(id, schema);
      }
      schema.x = projectile.x;
      schema.y = projectile.y;
    }

    for (const id of [...this.state.projectiles.keys()]) {
      if (!aliveIds.has(id)) this.state.projectiles.delete(id);
    }
  }
}
