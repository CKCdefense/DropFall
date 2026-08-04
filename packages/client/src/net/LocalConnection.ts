import { RoomPhase, TICK_RATE, World, type JobId, type PlayerInputMessage } from '@dropfall/shared';
import type { GameConnection, LobbyView, RoomInfo, WorldSnapshot } from './GameConnection';
import { SnapshotInterpolator } from './SnapshotInterpolator';

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
  /** world.tick()도 서버와 동일하게 TICK_RATE라 같은 보간이 필요하다(SnapshotInterpolator 참고). */
  private readonly interpolator = new SnapshotInterpolator();
  private readonly nickname: string;
  private job: JobId | '' = '';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(nickname: string) {
    this.nickname = nickname;
    // 서버(GameRoom#onJoin)와 마찬가지로 코어와 겹치지 않게 띄워 놓는다.
    this.world.addPlayer(LOCAL_SESSION_ID, SPAWN_X, SPAWN_Y);
    this.timer = setInterval(() => {
      this.world.tick(1 / TICK_RATE);
      this.interpolator.push(this.readRawSnapshot());
    }, 1000 / TICK_RATE);
  }

  get roomInfo(): RoomInfo {
    return { roomCode: 'LOCAL', roomName: '오프라인 테스트', hasPassword: false };
  }

  sendInput(input: PlayerInputMessage): void {
    this.world.setInput(LOCAL_SESSION_ID, input);
  }

  fire(weaponId: string): void {
    this.world.fireWeapon(LOCAL_SESSION_ID, weaponId);
  }

  voteSkipDay(): void {
    this.world.castSkipVote(LOCAL_SESSION_ID);
  }

  getSnapshot(): WorldSnapshot {
    return this.interpolator.sample();
  }

  private readRawSnapshot(): WorldSnapshot {
    const players: WorldSnapshot['players'] = [];
    for (const [id, player] of this.world.getPlayers()) {
      players.push({
        id,
        nickname: this.nickname,
        x: player.x,
        y: player.y,
        aimAngle: player.aimAngle,
        lastProcessedSeq: player.lastProcessedSeq,
        hp: player.hp,
      });
    }

    const monsters: WorldSnapshot['monsters'] = [];
    for (const [id, monster] of this.world.getMonsters()) {
      monsters.push({
        id,
        type: monster.type,
        x: monster.x,
        y: monster.y,
        hp: monster.hp,
        maxHp: monster.maxHp,
      });
    }

    const projectiles: WorldSnapshot['projectiles'] = [];
    for (const [id, projectile] of this.world.getProjectiles()) {
      projectiles.push({ id, x: projectile.x, y: projectile.y });
    }

    const core = this.world.getCore();

    return {
      players,
      monsters,
      projectiles,
      status: {
        coreHp: core.hp,
        coreMaxHp: core.maxHp,
        wavePhase: this.world.getWavePhase(),
        currentWave: this.world.getCurrentWave(),
        skipVoteCount: this.world.getSkipVoteCount(),
      },
    };
  }

  // ---------------------------------------------------------------- 대기실

  /**
   * 오프라인 모드는 혼자이고 방장이며, 대기실을 거치지 않고 바로 인게임으로 본다.
   * 직업만 로컬로 기억한다 — 서버가 없으니 동기화할 대상도 없다.
   */
  getLobbyView(): LobbyView {
    return {
      phase: RoomPhase.PLAYING,
      players: [
        {
          id: LOCAL_SESSION_ID,
          nickname: this.nickname,
          job: this.job,
          isReady: true,
          isHost: true,
          isMe: true,
        },
      ],
      amHost: true,
    };
  }

  selectJob(job: JobId): void {
    this.job = job;
  }

  setReady(): void {
    // 혼자라 준비 개념이 없다.
  }

  startGame(): void {
    // 이미 PLAYING 상태다.
  }

  onLobbyChange(): void {
    // 바뀔 상태가 없다.
  }

  onLobbyError(): void {
    // 서버가 없으니 거절도 없다.
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
