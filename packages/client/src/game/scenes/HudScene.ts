import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, MAX_CLIENTS_PER_ROOM } from '@dropfall/shared';
import type { GameConnection } from '../../net/GameConnection';
import { CONNECTION_KEY } from '../createGame';

export const HUD_SCENE_KEY = 'Hud';

const TEXT_STYLE = { fontFamily: 'monospace', fontSize: '8px', color: '#cfd6e4' } as const;
const DIM_STYLE = { ...TEXT_STYLE, color: '#79828f' } as const;

/**
 * HUD. GameScene과 분리된 별도 Scene이다 —
 * GameScene의 카메라는 플레이어를 따라 움직이지만 HUD는 화면에 고정되어야 한다.
 *
 * 인게임 UI는 DOM이 아니라 캔버스에 그린다. (docs/02-tech-spec.md §7.5)
 * 지금은 픽셀 폰트가 없어 monospace로 그린다 — 폰트 확정 후 비트맵 폰트로 교체한다.
 */
export class HudScene extends Phaser.Scene {
  private connection!: GameConnection;

  private roomText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private partyTexts: Phaser.GameObjects.Text[] = [];
  private debugText!: Phaser.GameObjects.Text;
  private coreBar!: Phaser.GameObjects.Rectangle;

  constructor() {
    super(HUD_SCENE_KEY);
  }

  init(): void {
    this.connection = this.registry.get(CONNECTION_KEY) as GameConnection;
  }

  create(): void {
    const { roomCode, roomName } = this.connection.roomInfo;

    // 상단: 방 정보 + 사이클/코어
    this.add.rectangle(0, 0, GAME_WIDTH, 12, 0x14161d, 0.85).setOrigin(0, 0);
    this.roomText = this.add.text(
      3,
      2,
      `${roomName}  [${roomCode}]${this.connection.isLocal ? '  *오프라인*' : ''}`,
      TEXT_STYLE,
    );
    this.waveText = this.add.text(GAME_WIDTH - 3, 2, '', TEXT_STYLE).setOrigin(1, 0);

    // 코어 HP — 아직 sim에 코어가 없다. 자리와 형태만 잡아둔 플레이스홀더다.
    this.add.text(3, 15, 'CORE', DIM_STYLE);
    this.add.rectangle(26, 16, 60, 5, 0x2b303c).setOrigin(0, 0);
    this.coreBar = this.add.rectangle(26, 16, 60, 5, 0x6fd08c).setOrigin(0, 0);

    // 우측: 파티 목록
    this.partyTexts = Array.from({ length: MAX_CLIENTS_PER_ROOM }, (_, index) =>
      this.add.text(GAME_WIDTH - 3, 16 + index * 9, '', TEXT_STYLE).setOrigin(1, 0),
    );

    // 하단: 디버그 정보 (개발 중에만 의미가 있다)
    this.debugText = this.add.text(3, GAME_HEIGHT - 10, '', DIM_STYLE);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'WASD 이동 / 마우스 조준 / ESC 나가기', DIM_STYLE)
      .setOrigin(0.5, 0);
  }

  update(): void {
    const snapshot = this.connection.getSnapshot();

    this.waveText.setText('DAY 1  ·  준비 단계');
    this.coreBar.width = 60; // TODO: sim에 코어 HP가 생기면 연결한다

    snapshot.players.forEach((player, index) => {
      const text = this.partyTexts[index];
      if (!text) return;
      const isMe = player.id === this.connection.sessionId;
      text.setText(`${isMe ? '>' : ' '} ${player.nickname}`);
      text.setColor(isMe ? '#6fd08c' : '#cfd6e4');
    });

    for (let i = snapshot.players.length; i < this.partyTexts.length; i += 1) {
      this.partyTexts[i]?.setText('');
    }

    const me = snapshot.players.find((player) => player.id === this.connection.sessionId);
    this.debugText.setText(
      me
        ? `x:${me.x.toFixed(0)} y:${me.y.toFixed(0)} seq:${me.lastProcessedSeq} players:${snapshot.players.length}`
        : '동기화 대기 중...',
    );
  }
}
