import type { PlayerInputMessage } from '@dropfall/shared';

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

export interface GameConnection {
  /** 내 플레이어를 식별하는 키 */
  readonly sessionId: string;
  readonly roomInfo: RoomInfo;
  /** 로컬 모드 여부 — HUD에 표시해서 혼동을 막는다 */
  readonly isLocal: boolean;

  sendInput(input: PlayerInputMessage): void;
  /** 매 프레임 호출된다. 구현체는 새 객체를 만들지 말고 내부 버퍼를 재사용할 것. */
  getSnapshot(): WorldSnapshot;

  /** 서버가 끊었거나 방이 사라졌을 때 */
  onDisconnect(callback: (reason: string) => void): void;
  leave(): Promise<void>;
}
