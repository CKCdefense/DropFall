export interface PlayerInputMessage {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  /**
   * 달리기(Shift)를 누르고 있는가. 이동·조준과 함께 매 틱 실려 오는 **상태**다 —
   * 눌렀다/뗐다를 따로 보내면 그중 하나가 유실됐을 때 영영 달리거나 영영 못 달린다.
   * 실제로 달렸는지는 서버가 정한다(스태미나가 남아 있고 실제로 움직이는 중일 때만).
   */
  sprint?: boolean;
  /**
   * 상호작용(E)을 누르고 있는가. sprint와 같은 이유로 **상태**로 싣는다 — 눌렀다/뗐다를
   * 따로 보내면 그중 하나가 유실됐을 때 구조가 영영 진행되거나 영영 멈춘다.
   *
   * 지금 쓰는 곳은 쓰러진 아군 구조 하나뿐이다. 코어 창은 클라이언트가 혼자 여닫으므로
   * 서버에 알릴 필요가 없다.
   */
  interact?: boolean;
}

/**
 * 퀵슬롯 선택. 무기 교체가 곧 슬롯 선택이다.
 *
 * 무기 id가 아니라 **슬롯 번호**를 보내는 게 핵심이다 — 서버가 그 칸에 실제로 뭐가
 * 들었는지 보고 판단하므로, 갖고 있지 않은 무기를 주장할 수 없다.
 */
export interface SelectSlotMessage {
  index: number;
}



/**
 * 슬롯 사이 아이템 이동(드래그앤드롭). 어느 컨테이너의 몇 번 칸에서 어디로 놓았는지만
 * 보낸다 — 그 칸에 뭐가 들었는지, 스택 병합/자리 바꾸기 처리는 전부 서버가 한다.
 */
export interface MoveItemMessage {
  from: 'inventory' | 'storage';
  fromIndex: number;
  to: 'inventory' | 'storage';
  toIndex: number;
  /**
   * 옮길 개수. **없으면 칸을 통째로** 옮긴다(예전 동작).
   *
   * 값이 있어도 서버가 1..보유량으로 조인다 — 클라이언트가 개수를 주장할 수 없다.
   * 낱개로 나누는 조작(Ctrl+드래그 = 절반)이 이 필드 하나로 표현된다.
   */
  count?: number;
}

/** 제작 요청. 어떤 레시피인지만 보낸다 — 티어·재료 검증은 전부 서버가 한다. */
export interface CraftMessage {
  recipeId: string;
}

/**
 * 스탯 포인트 하나를 쓴다. 몇 점을 쓸지는 안 보낸다 — 한 번에 여러 점을 넣으면
 * 중간에 포인트가 모자랄 때 몇 점이 들어갔는지가 애매해진다.
 */
/**
 * 코어에서 유령이 된 동료를 되살린다. 낮에만, 에너지를 치르고.
 *
 * 대상 id를 실어 보내는 이유는 유령이 여럿일 수 있어서다 — "아무나 하나"로 두면
 * 누구를 살릴지 서버가 정하게 되고, 그건 누른 사람이 정해야 하는 일이다.
 */
export interface ReviveGhostMessage {
  targetId: string;
}

export interface SpendStatPointMessage {
  stat: 'maxHp' | 'attack' | 'stamina';
}

/** 상점 구매. 진열된 물건 하나를 산다. */
export interface ShopBuyMessage {
  itemId: string;
}

/**
 * 개발자 커맨드 한 줄. **개발 모드에서만** 서버가 받아준다(GameRoom.isDevMode) —
 * 치트 자체라서 켜는 조건을 서버가 쥐고 있어야 한다.
 */
export interface DevCommandMessage {
  line: string;
}

/** 개발자 커맨드 실행 결과. 콘솔에 그대로 출력한다. */
export interface DevResultMessage {
  ok: boolean;
  message: string;
}

/**
 * 쉬프트 클릭 빠른 이동(docs/backend/44). 목적지는 안 보낸다 — 항상 반대편
 * 컨테이너(인벤토리↔창고)이고, 그 안 어느 칸에 넣을지는 서버가 자동으로 고른다.
 */
export interface QuickMoveItemMessage {
  /** 목적지. 없으면 예전 규칙(인벤토리↔창고)대로 반대편으로 간다. */
  to?: 'storage' | 'charge';
  container: 'inventory' | 'storage';
  index: number;
}

/**
 * 코어 AI 페르소나의 한 줄 대사. 웨이브 종료/콜로니 파괴/코어 상호작용 시 서버가
 * LLM(또는 실패 시 폴백 대사)으로 생성해 방 전체에 broadcast한다.
 */
export interface CoreCommentaryMessage {
  text: string;
}

/** server→client 브로드캐스트 메시지 이름. `room.broadcast(CORE_COMMENTARY_MESSAGE, ...)`. */
export const CORE_COMMENTARY_MESSAGE = 'coreCommentary';

/**
 * 티모시(AI 동반자)의 한 줄 대사. 코어 납품/근접 상호작용/다운·부활/웨이브 종료 시 서버가
 * 그 이벤트의 대상 플레이어 트레잇으로 LLM(또는 실패 시 폴백 대사)을 생성해 방 전체에
 * broadcast한다 — 코어 페르소나와 달리 방 전체가 아니라 특정 플레이어를 향한 대사다.
 */
export interface CompanionCommentaryMessage {
  text: string;
  /** 이 대사가 향하는 플레이어의 세션 id. */
  playerId: string;
}

export const COMPANION_COMMENTARY_MESSAGE = 'companionCommentary';

/**
 * 플레이어 채팅 한 줄. 클라→서버로는 텍스트만 보내고(`chat` 메시지, 페이로드 {text}),
 * 서버가 보낸 사람 정보(playerId/nickname)를 붙여 방 전체에 broadcast한다 — 방(팀)
 * 전체가 항상 볼 수 있는 채팅이라 거리 판정 없이 그대로 뿌린다.
 */
export interface ChatMessage {
  playerId: string;
  nickname: string;
  text: string;
}

export const CHAT_MESSAGE = 'chatMessage';
