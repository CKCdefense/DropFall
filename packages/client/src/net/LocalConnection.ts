import { TICK_RATE, World, type PlayerInputMessage } from '@dropfall/shared';
import type { GameConnection, RoomInfo, WorldSnapshot } from './GameConnection';

const LOCAL_SESSION_ID = 'local-player';
const SPAWN_X = 40;
const SPAWN_Y = 0;

/**
 * 서버 없이 브라우저 안에서 shared/sim을 그대로 돌리는 연결.
 *
 * 서버 작업이 막혀 있어도 클라이언트 개발이 멈추지 않게 하는 장치다.
 * `?local=1` 로 진입한다. shared/sim이 Phaser/DOM/Node에 의존하지 않기 때문에
 * 같은 코드가 여기서도 그대로 돈다. (docs/02-tech-spec.md §2.1)
 */
export class LocalConnection implements GameConnection {
  readonly isLocal = true;
  readonly sessionId = LOCAL_SESSION_ID;

  private readonly world = new World();
  private readonly snapshot: WorldSnapshot = { players: [] };
  private readonly nickname: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(nickname: string) {
    this.nickname = nickname;
    // 서버(GameRoom#onJoin)와 마찬가지로 코어와 겹치지 않게 띄워 놓는다.
    this.world.addPlayer(LOCAL_SESSION_ID, SPAWN_X, SPAWN_Y);
    this.timer = setInterval(() => this.world.tick(1 / TICK_RATE), 1000 / TICK_RATE);
  }

  get roomInfo(): RoomInfo {
    return { roomCode: 'LOCAL', roomName: '오프라인 테스트', hasPassword: false };
  }

  sendInput(input: PlayerInputMessage): void {
    this.world.setInput(LOCAL_SESSION_ID, input);
  }

  getSnapshot(): WorldSnapshot {
    const players = this.snapshot.players;
    players.length = 0;

    for (const [id, player] of this.world.getPlayers()) {
      players.push({
        id,
        nickname: this.nickname,
        x: player.x,
        y: player.y,
        aimAngle: player.aimAngle,
        lastProcessedSeq: player.lastProcessedSeq,
      });
    }

    return this.snapshot;
  }

  onDisconnect(): void {
    // 로컬 모드에는 끊길 연결이 없다.
  }

  async leave(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
