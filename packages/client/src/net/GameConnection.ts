import type {
  InventorySlot,
  JobId,
  PlayerInputMessage,
  RoomPhase,
  SlotContainer,
} from '@dropfall/shared';

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
  /** 흔한 몬스터 처치로 받는 휴대 자원. 나무/돌과 동일하게 deposit()으로 입고한다. */
  /** 휴대 중인 부품(drop_normal) 개수. */
  parts: number;
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

/** 바닥에 떨어진 아이템. 주우면 인벤토리로 들어간다. */
export interface DroppedItemView {
  id: string;
  itemId: string;
  count: number;
  x: number;
  y: number;
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

/**
 * AI 동반자("티모시"). 방(팀)당 1마리라 배열이 아니라 단일 객체다 — `id`는 보간기의
 * `Positioned` 인터페이스(id로 짝을 찾음)를 그대로 재사용하려고 고정값 하나만 둔다.
 */
export interface CompanionView {
  id: 'companion';
  x: number;
  y: number;
  /** 렌더러가 보고 걷는 방향을 정한다(플레이어의 aimAngle과 같은 역할, 조준 대신 이동 방향). */
  facingX: number;
  facingY: number;
  /** CompanionState('seeking'|'traveling'|'harvesting'|'returning'|'depositing'|'downed') */
  state: string;
  carriedWood: number;
  carriedStone: number;
  hp: number;
  maxHp: number;
}

/** 위치가 없는 값들 — 보간 대상이 아니라 항상 최신값을 그대로 쓴다. */
export interface WorldStatus {
  coreHp: number;
  coreMaxHp: number;
  /** 코어에 입고된 팀 공유 자원. 건축 비용은 여기서 나간다(개인 wood/stone이 아니다). */
  coreSharedWood: number;
  coreSharedStone: number;
  /** 팀 공용 자금. 상점 구매에 쓴다. */
  coreMoney: number;
  /** 오늘의 상점 진열(아이템 id). 낮이 될 때마다 통째로 바뀐다. */
  shopStock: string[];
  /** 창고에 쌓인 부품(drop_normal). 상점 판매의 주 수입원이다. */
  coreParts: number;
  /** 콜로니 파괴 또는 보스 처치로만 얻는 희귀 자원. 코어 업그레이드/상점 구입 전용(아직 소비처 미구현). */
  coreSharedEnergy: number;
  /** 구매한 코어 업그레이드 단계(0부터, 미구매 상태). */
  coreTier: number;
  /** 코어 원점 기준 건설 가능 반경(px) — 업그레이드로 늘어난다. */
  coreBuildRadius: number;
  /** 제작(CraftModal) 해금 여부. */
  craftingUnlocked: boolean;
  /** 플레이어 스텟 증가 시스템 해금 여부(아직 그걸 쓸 UI/구매 로직은 없음 — 플래그만). */
  statUpgradesUnlocked: boolean;
  /** GamePhase: 'day' | 'night' | 'victory' | 'defeat' */
  wavePhase: string;
  currentWave: number;
  /** 현재 페이즈가 끝나기까지 남은 시간(초) */
  phaseTimeRemaining: number;
  /** 낮 스킵 투표 동의 인원. 필요 인원은 players.length(만장일치) */
  skipVoteCount: number;
  /** 코어 창고 슬롯. 인벤토리와 같은 구조(빈 칸은 null). */
  coreStorage: (InventorySlot | null)[];
}

export interface WorldSnapshot {
  players: PlayerView[];
  monsters: MonsterView[];
  projectiles: ProjectileView[];
  resourceNodes: ResourceNodeView[];
  droppedItems: DroppedItemView[];
  buildings: BuildingView[];
  colonies: ColonyView[];
  companion: CompanionView;
  status: WorldStatus;
  /**
   * 팀이 밝힌 지역(칸당 1비트, explored.ts). 미니맵 안개가 이걸 그대로 마스크로 쓴다.
   * 보간 대상이 아니라 항상 최신값이다.
   */
  explored: ArrayLike<number>;
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
   * 근처 바닥 드롭 줍기(E). 가장 가까운 것 하나가 인벤토리로 들어온다 —
   * 자원 노드를 부수면 바로 지갑에 꽂히지 않고 바닥에 떨어지므로, 회수는 별도 행동이다.
   * 채집 자체는 도구를 장착하고 `fire()`(근접 공격)로 노드를 때리는 방식이다.
   */
  pickUp(): void;
  /**
   * 슬롯 사이 아이템 이동(드래그앤드롭). 인벤토리↔창고, 인벤토리 내부 재배치 모두
   * 이 하나로 처리한다. 창고가 얽힌 이동은 서버가 코어 거리로 거른다.
   */
  moveItem(from: SlotContainer, fromIndex: number, to: SlotContainer, toIndex: number): void;
  /**
   * 쉬프트 클릭 빠른 이동(docs/backend/44). 목적지 칸은 안 정한다 — 항상 반대편
   * 컨테이너에, 서버가 알아서 쌓거나 빈 칸을 골라 넣는다.
   */
  quickMoveItem(container: SlotContainer, index: number): void;
  /**
   * 코어 업그레이드 요청. 다음 단계 비용을 팀 공유 에너지에서 차감하고 코어
   * 체력/건설 가능 반경/제작·스텟증가 해금을 한 번에 적용한다 — 서버가 비용/최고
   * 단계 여부를 판정한다.
   */
  upgradeCore(): void;
  /**
   * 코어 앞에서 상호작용(모달 열기)했음을 알린다. 서버가 쿨다운을 판단해 코어 AI
   * 페르소나 대사를 새로 생성할지 정한다 — 여기선 그냥 요청만 보낸다.
   */
  coreInteract(): void;
  /** 제작 요청. 티어·재료 검증은 서버가 한다. */
  craft(recipeId: string): void;
  /** 창고의 재료를 상점에 판다(대금은 팀 자금으로). */
  shopSell(itemId: string, count: number): void;
  /** 상점에서 산다(물건은 창고로). */
  shopBuy(itemId: string): void;
  /** 건축 요청. cx/cy는 그리드 셀 좌표(worldToCell로 미리 변환해서 넘긴다). */
  placeBuilding(buildingType: string, cx: number, cy: number): void;
  /** 철거 요청(건설모드의 'demolish', docs/backend/43). 자원 환급 없음. */
  demolishBuilding(cx: number, cy: number): void;
  /** 매 프레임 호출된다. 구현체는 새 객체를 만들지 말고 내부 버퍼를 재사용할 것. */
  getSnapshot(): WorldSnapshot;
  /**
   * 테스트용: 지정한 웨이브(1-based)로 즉시 이동한다(docs/backend/23). 로컬 모드에서만
   * 제공한다 — 옵셔널이라 실제 멀티플레이(ColyseusConnection)에서는 아예 존재하지
   * 않으므로, UI는 `connection.debugJumpToWave`가 있는지 확인하는 것만으로 로컬
   * 모드 여부와 무관하게 자연스럽게 버튼을 숨길 수 있다.
   */
  debugJumpToWave?(waveNumber: number): void;

  /**
   * 개발자 커맨드 한 줄을 실행한다(devCommands.ts의 `runDevCommand`).
   *
   * 로컬 모드는 월드를 직접 들고 있어 결과를 바로 돌려주지만, 멀티플레이는 서버가
   * 판정하고 결과가 나중에 온다 — 그래서 반환값이 아니라 `onDevResult` 콜백으로
   * 통일했다. 두 모드가 같은 경로를 쓰면 콘솔 UI가 분기를 안 해도 된다.
   *
   * 개발 모드가 아닌 서버는 이 메시지를 조용히 무시한다(응답도 없다).
   */
  sendDevCommand(line: string): void;
  onDevResult(callback: (result: { ok: boolean; message: string }) => void): void;

  /**
   * 코어 AI 페르소나가 새 대사를 말할 때마다 호출된다(웨이브 종료/콜로니 파괴/코어
   * 상호작용 시 서버가 broadcast). LocalConnection은 실제 LLM 호출 없이 폴백 대사만
   * 돌려준다 — API 키를 클라이언트 번들에 넣지 않기 위해서다.
   */
  onCoreCommentary(callback: (text: string) => void): void;

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
