import { Client, type Room } from '@colyseus/sdk';
import type {
  CreateRoomOptions,
  SlotContainer,
  JobId,
  JoinRoomOptions,
  PlayerInputMessage,
  RoomPhase,
} from '@dropfall/shared';
import {
  CHAT_MESSAGE,
  COMPANION_COMMENTARY_MESSAGE,
  CORE_COMMENTARY_MESSAGE,
  EXPLORED_BYTE_COUNT,
  LOBBY_ERROR_MESSAGE,
  LobbyMessage,
  RoomErrorCode,
  RoomPhase as RoomPhaseValue,
  normalizeRoomCode,
} from '@dropfall/shared';
import { SERVER_HTTP_URL } from './config';
import type { GameConnection, LobbyView, RoomInfo, WorldSnapshot } from './GameConnection';
import { SnapshotInterpolator } from './SnapshotInterpolator';

/** 서버 상태가 오기 전에 쓸 빈 안개 — 전부 미탐색. */
const EMPTY_EXPLORED = new Uint8Array(EXPLORED_BYTE_COUNT);

/** 서버 Schema를 클라이언트 관점에서 본 모양. 서버의 GameRoomState와 1:1로 맞춘다. */
interface RemotePlayerState {
  nickname: string;
  job: string;
  isReady: boolean;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  attack: number;
  ammo: number;
  ammoMagazine: number;
  reloadRemaining: number;
  burstMode: boolean;
  wood: number;
  stone: number;
  parts: number;
  slots: { itemId: string; count: number }[];
  selectedSlot: number;
}

interface RemoteMonsterState {
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attacking: boolean;
  attackAnim: number;
  attackSeq: number;
  facingLeft: boolean;
  telegraphKind: string;
  telegraphX: number;
  telegraphY: number;
  telegraphDirX: number;
  telegraphDirY: number;
  telegraphRadius: number;
  telegraphRange: number;
  telegraphRemaining: number;
  telegraphTotal: number;
}

interface RemoteResourceNodeState {
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

interface RemoteBuildingState {
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

interface RemoteColonyState {
  x: number;
  y: number;
  stage: number;
  stored: number;
  purified: boolean;
}

interface RemoteGameState {
  roomCode: string;
  roomName: string;
  hasPassword: boolean;
  phase: string;
  hostSessionId: string;
  coreHp: number;
  coreMaxHp: number;
  coreSharedWood: number;
  coreSharedStone: number;
  coreParts: number;
  coreSharedEnergy: number;
  coreMoney: number;
  shopStock: ArrayLike<string>;
  explored: ArrayLike<number>;
  coreTier: number;
  coreBuildRadius: number;
  craftingUnlocked: boolean;
  statUpgradesUnlocked: boolean;
  wavePhase: string;
  currentWave: number;
  phaseTimeRemaining: number;
  skipVoteCount: number;
  players: {
    size: number;
    forEach(callback: (value: RemotePlayerState, key: string) => void): void;
  };
  monsters: {
    forEach(callback: (value: RemoteMonsterState, key: string) => void): void;
  };
  projectiles: {
    forEach(callback: (value: { x: number; y: number; angle: number }, key: string) => void): void;
  };
  resourceNodes: {
    forEach(callback: (value: RemoteResourceNodeState, key: string) => void): void;
  };
  droppedItems: {
    forEach(
      callback: (value: { itemId: string; count: number; x: number; y: number }, key: string) => void,
    ): void;
  };
  coreStorage: ArrayLike<{ itemId: string; count: number }>;
  buildings: {
    forEach(callback: (value: RemoteBuildingState, key: string) => void): void;
  };
  colonies: {
    forEach(callback: (value: RemoteColonyState, key: string) => void): void;
  };
  companion: {
    x: number;
    y: number;
    facingX: number;
    facingY: number;
    state: string;
    carriedWood: number;
    carriedStone: number;
    hp: number;
    maxHp: number;
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

  /** 서버는 TICK_RATE로만 상태를 보내는데 화면은 60fps로 그리므로, 보간해서 부드럽게 재생한다. */
  private readonly interpolator = new SnapshotInterpolator();
  private readonly lobbyListeners: (() => void)[] = [];
  private readonly lobbyErrorListeners: ((message: string) => void)[] = [];
  private latestPing = 0;

  constructor(private readonly room: GameRoom) {
    this.room.ping((ms) => {
      this.latestPing = ms;
    });

    // 상태 패치가 도착할 때마다(서버 틱과 동일한 주기) 보간 버퍼에 쌓는다.
    this.room.onStateChange((state) => {
      this.interpolator.push(this.readRawSnapshot(state));
      for (const listener of this.lobbyListeners) listener();
    });

    this.room.onMessage(LOBBY_ERROR_MESSAGE, (message: string) => {
      for (const listener of this.lobbyErrorListeners) listener(message);
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

  fire(): void {
    // 무기 id를 싣지 않는다 — 서버가 선택된 슬롯에서 읽는다(World.fireWeapon).
    this.room.send('fire', {});
  }

  selectSlot(index: number): void {
    this.room.send('selectSlot', { index });
  }

  reload(): void {
    this.room.send('reload', {});
  }

  toggleFireMode(): void {
    this.room.send('toggleFireMode', {});
  }

  useSlot(): void {
    this.room.send('useSlot', {});
  }

  voteSkipDay(): void {
    this.room.send('skipVote', {});
  }

  pickUp(): void {
    this.room.send('deposit', {});
  }

  moveItem(from: SlotContainer, fromIndex: number, to: SlotContainer, toIndex: number): void {
    this.room.send('moveItem', { from, fromIndex, to, toIndex });
  }

  discardStorageItem(index: number): void {
    this.room.send('discardStorageItem', { index });
  }

  quickMoveItem(container: SlotContainer, index: number): void {
    this.room.send('quickMoveItem', { container, index });
  }

  craft(recipeId: string): void {
    this.room.send('craft', { recipeId });
  }

  shopSell(itemId: string, count: number): void {
    this.room.send('shopSell', { itemId, count });
  }

  shopBuy(itemId: string): void {
    this.room.send('shopBuy', { itemId });
  }

  sendDevCommand(line: string): void {
    this.room.send('dev', { line });
  }

  onDevResult(callback: (result: { ok: boolean; message: string }) => void): void {
    this.room.onMessage('devResult', callback);
  }

  upgradeCore(): void {
    this.room.send('upgradeCore', {});
  }

  coreInteract(): void {
    this.room.send('coreInteract', {});
  }

  onCoreCommentary(callback: (text: string) => void): void {
    this.room.onMessage(CORE_COMMENTARY_MESSAGE, (message: { text: string }) => callback(message.text));
  }

  companionInteract(): void {
    this.room.send('companionInteract', {});
  }

  onCompanionCommentary(callback: (text: string, playerId: string) => void): void {
    this.room.onMessage(COMPANION_COMMENTARY_MESSAGE, (message: { text: string; playerId: string }) =>
      callback(message.text, message.playerId),
    );
  }

  sendChat(text: string): void {
    this.room.send('chat', { text });
  }

  onChatMessage(
    callback: (message: { playerId: string; nickname: string; text: string }) => void,
  ): void {
    this.room.onMessage(CHAT_MESSAGE, callback);
  }

  placeBuilding(buildingType: string, cx: number, cy: number): void {
    this.room.send('placeBuilding', { buildingType, cx, cy });
  }

  demolishBuilding(cx: number, cy: number): void {
    this.room.send('demolishBuilding', { cx, cy });
  }

  /** 화면 렌더링용. TICK_RATE 상태를 60fps에 맞게 보간한, 몇 ms 지연된 스냅샷을 돌려준다. */
  getSnapshot(): WorldSnapshot {
    return this.interpolator.sample();
  }

  /** 보간 버퍼에 쌓기 위해 서버 Schema를 평범한 배열로 변환한다. */
  private readRawSnapshot(state: RemoteGameState): WorldSnapshot {
    const players: WorldSnapshot['players'] = [];
    state?.players?.forEach((player, id) => {
      players.push({
        id,
        nickname: player.nickname,
        job: (player.job || '') as JobId | '',
        x: player.x,
        y: player.y,
        aimAngle: player.aimAngle,
        lastProcessedSeq: player.lastProcessedSeq,
        hp: player.hp,
        maxHp: player.maxHp,
        stamina: player.stamina,
        maxStamina: player.maxStamina,
        attack: player.attack,
        ammo: player.ammo,
        ammoMagazine: player.ammoMagazine,
        reloadRemaining: player.reloadRemaining,
        burstMode: player.burstMode,
        wood: player.wood,
        stone: player.stone,
        parts: player.parts,
        // 서버는 빈 칸을 itemId '' 로 내려보낸다(길이 고정). 클라이언트 표현은 null이다.
        slots: Array.from(player.slots ?? [], (slot) =>
          slot.itemId ? { itemId: slot.itemId, count: slot.count } : null,
        ),
        selectedSlot: player.selectedSlot,
      });
    });

    const monsters: WorldSnapshot['monsters'] = [];
    state?.monsters?.forEach((monster, id) => {
      monsters.push({
        id,
        type: monster.type,
        x: monster.x,
        y: monster.y,
        hp: monster.hp,
        maxHp: monster.maxHp,
        attacking: monster.attacking,
        attackAnim: monster.attackAnim,
        attackSeq: monster.attackSeq,
        facingLeft: monster.facingLeft,
        telegraphKind: (monster.telegraphKind || '') as '' | 'charge' | 'slam',
        telegraphX: monster.telegraphX,
        telegraphY: monster.telegraphY,
        telegraphDirX: monster.telegraphDirX,
        telegraphDirY: monster.telegraphDirY,
        telegraphRadius: monster.telegraphRadius,
        telegraphRange: monster.telegraphRange,
        telegraphRemaining: monster.telegraphRemaining,
        telegraphTotal: monster.telegraphTotal,
      });
    });

    const projectiles: WorldSnapshot['projectiles'] = [];
    state?.projectiles?.forEach((projectile, id) => {
      projectiles.push({ id, x: projectile.x, y: projectile.y, angle: projectile.angle });
    });

    const droppedItems: WorldSnapshot['droppedItems'] = [];
    state?.droppedItems?.forEach((drop, id) => {
      droppedItems.push({ id, itemId: drop.itemId, count: drop.count, x: drop.x, y: drop.y });
    });

    const resourceNodes: WorldSnapshot['resourceNodes'] = [];
    state?.resourceNodes?.forEach((node, id) => {
      resourceNodes.push({
        id,
        type: node.type,
        x: node.x,
        y: node.y,
        hp: node.hp,
        maxHp: node.maxHp,
      });
    });

    const buildings: WorldSnapshot['buildings'] = [];
    state?.buildings?.forEach((building, id) => {
      buildings.push({
        id,
        type: building.type,
        x: building.x,
        y: building.y,
        hp: building.hp,
        maxHp: building.maxHp,
      });
    });

    const colonies: WorldSnapshot['colonies'] = [];
    state?.colonies?.forEach((colony, id) => {
      colonies.push({
        id,
        x: colony.x,
        y: colony.y,
        stage: colony.stage,
        stored: colony.stored,
        purified: colony.purified,
      });
    });

    const companion: WorldSnapshot['companion'] = {
      id: 'companion',
      x: state?.companion?.x ?? 0,
      y: state?.companion?.y ?? 0,
      facingX: state?.companion?.facingX ?? 0,
      facingY: state?.companion?.facingY ?? 1,
      state: state?.companion?.state ?? 'seeking',
      carriedWood: state?.companion?.carriedWood ?? 0,
      carriedStone: state?.companion?.carriedStone ?? 0,
      hp: state?.companion?.hp ?? 0,
      maxHp: state?.companion?.maxHp ?? 0,
    };

    return {
      players,
      monsters,
      projectiles,
      resourceNodes,
      droppedItems,
      buildings,
      colonies,
      companion,
      explored: state?.explored ?? EMPTY_EXPLORED,
      status: {
        coreHp: state?.coreHp ?? 0,
        coreMaxHp: state?.coreMaxHp ?? 0,
        coreSharedWood: state?.coreSharedWood ?? 0,
        coreSharedStone: state?.coreSharedStone ?? 0,
        coreParts: state?.coreParts ?? 0,
        coreSharedEnergy: state?.coreSharedEnergy ?? 0,
        coreMoney: state?.coreMoney ?? 0,
        shopStock: Array.from(state?.shopStock ?? []),
        coreTier: state?.coreTier ?? 0,
        coreBuildRadius: state?.coreBuildRadius ?? 0,
        craftingUnlocked: state?.craftingUnlocked ?? false,
        statUpgradesUnlocked: state?.statUpgradesUnlocked ?? false,
        wavePhase: state?.wavePhase ?? 'day',
        currentWave: state?.currentWave ?? 0,
        phaseTimeRemaining: state?.phaseTimeRemaining ?? 0,
        skipVoteCount: state?.skipVoteCount ?? 0,
        // 서버는 빈 칸을 itemId ''로 내려보낸다(길이 고정). 클라이언트 표현은 null이다.
        coreStorage: Array.from(state?.coreStorage ?? [], (slot) =>
          slot.itemId ? { itemId: slot.itemId, count: slot.count } : null,
        ),
      },
    };
  }

  // ---------------------------------------------------------------- 대기실

  getLobbyView(): LobbyView {
    const state = this.room.state;
    const hostId = state?.hostSessionId ?? '';
    const players: LobbyView['players'] = [];

    state?.players?.forEach((player, id) => {
      players.push({
        id,
        nickname: player.nickname,
        job: (player.job || '') as JobId | '',
        isReady: player.isReady,
        isHost: id === hostId,
        isMe: id === this.room.sessionId,
      });
    });

    return {
      phase: (state?.phase as RoomPhase) ?? RoomPhaseValue.LOBBY,
      players,
      amHost: hostId === this.room.sessionId,
    };
  }

  selectJob(job: JobId): void {
    this.room.send(LobbyMessage.SELECT_JOB, { job });
  }

  setReady(ready: boolean): void {
    this.room.send(LobbyMessage.SET_READY, { ready });
  }

  startGame(): void {
    this.room.send(LobbyMessage.START_GAME, {});
  }

  onLobbyChange(callback: () => void): void {
    this.lobbyListeners.push(callback);
  }

  onLobbyError(callback: (message: string) => void): void {
    this.lobbyErrorListeners.push(callback);
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
