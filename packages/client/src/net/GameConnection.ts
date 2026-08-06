import type { InventorySlot, JobId, PlayerInputMessage, RoomPhase } from '@dropfall/shared';

/**
 * 렌더링이 소비하는 엔티티 스냅샷.
 *
 * 이 인터페이스가 존재하는 이유:
 * 게임 화면(Scene/Renderer)은 데이터가 서버에서 왔는지 브라우저 안에서 돌린
 * 시뮬레이션에서 왔는지 알 필요가 없다. 덕분에 서버 작업과 무관하게
 * 클라이언트를 계속 진행할 수 있다(LocalConnection).
 */
export interface PlayerView {
  id: string;
  nickname: string;
  /** 선택 전에는 빈 문자열. 렌더러가 직업별 스프라이트를 고르는 데 쓴다. */
  job: JobId | '';
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
  hp: number;
  /** 아직 코어에 입고하지 않고 들고 있는 나무/돌. 코어 근처에서 deposit()하면 0이 된다. */
  wood: number;
  stone: number;
  /** 퀵슬롯. 길이는 항상 SLOT_COUNT이고 빈 칸은 null이다. */
  slots: (InventorySlot | null)[];
  selectedSlot: number;
  /** 콜로니 채널링(파괴 작업) 진행률(0~1). 채널링 중이 아니면 0. */
  channelProgress: number;
}

export interface MonsterView {
  id: string;
  /** MonsterType. 렌더러가 색/크기를 고르는 데만 쓴다 */
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 보스 전용 공격 예고(텔레그래프). 진행 중이 아니면 빈 문자열. */
  telegraphKind: '' | 'charge' | 'slam';
  telegraphX: number;
  telegraphY: number;
  telegraphDirX: number;
  telegraphDirY: number;
  /** 돌진: 경로 폭의 절반. 광역: 범위 반경. */
  telegraphRadius: number;
  /** 돌진: 예고 종료 시 실제로 도달할 거리. 광역: 0. */
  telegraphRange: number;
  telegraphRemaining: number;
  telegraphTotal: number;
}

export interface ProjectileView {
  id: string;
  x: number;
  y: number;
  /** 진행 방향(라디안). 탄환 스프라이트를 이 각도로 눕힌다. */
  angle: number;
}

export interface ResourceNodeView {
  id: string;
  /** ResourceType('wood' | 'stone'). 렌더러가 색/모양을 고르는 데만 쓴다 */
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface BuildingView {
  id: string;
  /** BuildingType('fence' | 'wall'). 렌더러가 색/크기를 고르는 데만 쓴다 */
  type: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface ColonyView {
  id: string;
  x: number;
  y: number;
  /** 채널링 1회 완료로 파괴됐는지. 파괴돼도 위치는 계속 내려온다(렌더러가 흐리게/제거를 결정). */
  destroyed: boolean;
}

/** 위치가 없는 값들 — 보간 대상이 아니라 항상 최신값을 그대로 쓴다. */
export interface WorldStatus {
  coreHp: number;
  coreMaxHp: number;
  /** 코어에 입고된 팀 공유 자원. 건축 비용은 여기서 나간다(개인 wood/stone이 아니다). */
  coreSharedWood: number;
  coreSharedStone: number;
  /** 콜로니 파괴로만 얻는 전용 자원. 코어 업그레이드/상점 구입 전용(아직 소비처 미구현). */
  coreSharedEnergy: number;
  /** GamePhase: 'day' | 'night' | 'victory' | 'defeat' */
  wavePhase: string;
  currentWave: number;
  /** 현재 페이즈가 끝나기까지 남은 시간(초) */
  phaseTimeRemaining: number;
  /** 낮 스킵 투표 동의 인원. 필요 인원은 players.length(만장일치) */
  skipVoteCount: number;
}

export interface WorldSnapshot {
  players: PlayerView[];
  monsters: MonsterView[];
  projectiles: ProjectileView[];
  resourceNodes: ResourceNodeView[];
  buildings: BuildingView[];
  colonies: ColonyView[];
  status: WorldStatus;
}

export interface RoomInfo {
  roomCode: string;
  roomName: string;
  hasPassword: boolean;
}

/** 대기실 화면이 보는 플레이어 한 명 */
export interface LobbyPlayer {
  id: string;
  nickname: string;
  /** 미선택이면 빈 문자열 */
  job: JobId | '';
  isReady: boolean;
  isHost: boolean;
  isMe: boolean;
}

/** 대기실 화면이 보는 방 상태 */
export interface LobbyView {
  phase: RoomPhase;
  players: LobbyPlayer[];
  amHost: boolean;
}

export interface GameConnection {
  /** 내 플레이어를 식별하는 키 */
  readonly sessionId: string;
  readonly roomInfo: RoomInfo;
  /** 로컬 모드 여부 — HUD에 표시해서 혼동을 막는다 */
  readonly isLocal: boolean;

  sendInput(input: PlayerInputMessage): void;
  /**
   * 공격. 무기 id를 보내지 않는다 — 서버가 선택된 슬롯에서 읽는다.
   * 쿨다운·탄약 판정도 서버 몫이라 클라이언트는 눌렸다는 사실만 보낸다.
   */
  fire(): void;
  /** 퀵슬롯 선택(= 무기 교체). 서버가 그 칸의 실제 내용물을 보고 판단한다. */
  selectSlot(index: number): void;
  /** 선택 중인 소모품 사용. 쓸 수 없는 슬롯이면 서버가 조용히 무시한다. */
  useSlot(): void;
  /** 낮 넘기기 투표 (만장일치) */
  voteSkipDay(): void;
  /**
   * 코어 입고 요청. 들고 있는(아직 코어에 안 넣은) 나무/돌을 팀 공유 창고로 옮긴다 —
   * 코어 근처에서만 되고, 서버가 거리와 보유량을 판정한다. 채집 자체는 이 메서드가
   * 아니라 도구를 장착하고 `fire()`(근접 공격)로 자원 노드를 때리는 방식이다.
   */
  deposit(): void;
  /** 건축 요청. cx/cy는 그리드 셀 좌표(worldToCell로 미리 변환해서 넘긴다). */
  placeBuilding(buildingType: string, cx: number, cy: number): void;
  /** 매 프레임 호출된다. 구현체는 새 객체를 만들지 말고 내부 버퍼를 재사용할 것. */
  getSnapshot(): WorldSnapshot;
  /**
   * 테스트용: 지정한 웨이브(1-based)로 즉시 이동한다(docs/backend/23). 로컬 모드에서만
   * 제공한다 — 옵셔널이라 실제 멀티플레이(ColyseusConnection)에서는 아예 존재하지
   * 않으므로, UI는 `connection.debugJumpToWave`가 있는지 확인하는 것만으로 로컬
   * 모드 여부와 무관하게 자연스럽게 버튼을 숨길 수 있다.
   */
  debugJumpToWave?(waveNumber: number): void;

  // ---------------------------------------------------------------- 대기실

  getLobbyView(): LobbyView;
  selectJob(job: JobId): void;
  setReady(ready: boolean): void;
  /** 방장만 유효하다. 서버가 최종 판정하고 거절 사유를 onLobbyError로 돌려준다. */
  startGame(): void;

  /** 방 상태가 바뀔 때마다 호출된다 — 대기실 UI를 다시 그리는 신호 */
  onLobbyChange(callback: () => void): void;
  /** 시작 거절 등 대기실 오류 메시지 */
  onLobbyError(callback: (message: string) => void): void;

  /** 서버가 끊었거나 방이 사라졌을 때 */
  onDisconnect(callback: (reason: string) => void): void;
  leave(): Promise<void>;
}
