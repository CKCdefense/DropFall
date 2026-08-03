import type { JobId, PlayerInputMessage, RoomPhase } from '@dropfall/shared';

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
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
}

export interface WorldSnapshot {
  players: PlayerView[];
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
  /** 매 프레임 호출된다. 구현체는 새 객체를 만들지 말고 내부 버퍼를 재사용할 것. */
  getSnapshot(): WorldSnapshot;

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
