export interface PlayerInputMessage {
  seq: number;
  moveX: number;
  moveY: number;
  aimAngle: number;
  /**
   * 콜로니 채널링(파괴 작업) 키를 누르고 있는지. moveX/moveY/aimAngle과 같은
   * "누르고 있는 동안" 모델이라 여기 실어 매 틱 재전송한다 — 별도 메시지 타입을
   * 만들지 않는다. 옵셔널인 이유: 이 필드가 생기기 전의 기존 테스트/호출부가
   * 굳이 다 고치지 않아도 되게(누락 시 World.setInput이 false로 취급한다).
   */
  channeling?: boolean;
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
 * 건축 요청. 그리드 스냅(어느 셀을 가리키는지)은 클라이언트가 계산해서 셀 좌표로
 * 보낸다 — 서버는 좌표 변환 없이 그 셀에 지을 수 있는지만 검증한다. 채집(`harvest`)은
 * 반경 안 가장 가까운 노드에 자동으로 적용되니 별도 좌표가 필요 없어 메시지 타입이
 * 없다(페이로드 없는 이벤트).
 */
export interface BuildInputMessage {
  buildingType: string;
  cx: number;
  cy: number;
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
}

/** 제작 요청. 어떤 레시피인지만 보낸다 — 티어·재료 검증은 전부 서버가 한다. */
export interface CraftMessage {
  recipeId: string;
}

/** 상점 판매. 창고에 있는 재료를 개수만큼 판다. */
export interface ShopSellMessage {
  itemId: string;
  count: number;
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
