import Phaser from 'phaser';
import { MAX_CLIENTS_PER_ROOM, computeCameraZoom } from '@dropfall/shared';
import type { GameConnection, WorldStatus } from '../../net/GameConnection';
import { CONNECTION_KEY } from '../createGame';

export const HUD_SCENE_KEY = 'Hud';

/**
 * HUD는 카메라 줌 1(네이티브 해상도)에 그려진다 — 그래서 실제 픽셀 크기를 그대로 쓴다.
 * 한글은 자소 조합 구조라 최소 14px은 되어야 편하게 읽힌다.
 */
const FONT = 'ui-monospace, "Malgun Gothic", monospace';
const TEXT_STYLE = { fontFamily: FONT, fontSize: '14px', color: '#cfd6e4' } as const;
const DIM_STYLE = { fontFamily: FONT, fontSize: '13px', color: '#79828f' } as const;
const ACCENT = '#6fd08c';
const DOWN_COLOR = '#d9756b';

/** 기준 크기(px). 화면이 커지면 uiScale이 곱해진다. */
const TEXT_SIZE = 14;
const DIM_SIZE = 13;
const PAD = 12;
const TOP_BAR_HEIGHT = 26;
const CORE_BAR_WIDTH = 140;
const CORE_BAR_HEIGHT = 8;
const PARTY_LINE_HEIGHT = 18;
const CORE_LABEL_WIDTH = 78;

/**
 * HUD. GameScene과 분리된 별도 Scene이다 —
 * GameScene의 카메라는 플레이어를 따라 줌/이동하지만 HUD는 화면에 고정되고
 * 줌의 영향을 받지 않아야 한다. (docs/frontend/01-client-architecture.md §2.3)
 */
export class HudScene extends Phaser.Scene {
  private connection!: GameConnection;

  private topBar!: Phaser.GameObjects.Rectangle;
  private roomText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private coreLabel!: Phaser.GameObjects.Text;
  private coreBarBack!: Phaser.GameObjects.Rectangle;
  private coreBar!: Phaser.GameObjects.Rectangle;
  private partyTexts: Phaser.GameObjects.Text[] = [];
  private debugText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
  /** 코어 바 갱신 시 기준 폭을 알아야 해서 보관한다. */
  private uiScale = 1;

  constructor() {
    super(HUD_SCENE_KEY);
  }

  init(): void {
    this.connection = this.registry.get(CONNECTION_KEY) as GameConnection;
  }

  create(): void {
    const { roomCode, roomName } = this.connection.roomInfo;

    this.topBar = this.add.rectangle(0, 0, 10, TOP_BAR_HEIGHT, 0x14161d, 0.85).setOrigin(0, 0);
    this.roomText = this.add.text(
      0,
      0,
      `${roomName}  [${roomCode}]${this.connection.isLocal ? '  · 오프라인' : ''}`,
      TEXT_STYLE,
    );
    this.waveText = this.add.text(0, 0, 'DAY 1  ·  준비 단계', TEXT_STYLE).setOrigin(1, 0);

    // 코어 HP — 아직 sim에 코어가 없다. 자리와 형태만 잡아둔 플레이스홀더다.
    this.coreLabel = this.add.text(0, 0, 'CORE', DIM_STYLE);
    this.coreBarBack = this.add
      .rectangle(0, 0, CORE_BAR_WIDTH, CORE_BAR_HEIGHT, 0x2b303c)
      .setOrigin(0, 0);
    this.coreBar = this.add
      .rectangle(0, 0, CORE_BAR_WIDTH, CORE_BAR_HEIGHT, 0x6fd08c)
      .setOrigin(0, 0);

    this.partyTexts = Array.from({ length: MAX_CLIENTS_PER_ROOM }, () =>
      this.add.text(0, 0, '', TEXT_STYLE).setOrigin(1, 0),
    );

    this.debugText = this.add.text(0, 0, '', DIM_STYLE);
    this.helpText = this.add
      .text(0, 0, 'WASD 이동  ·  마우스 조준  ·  ESC 나가기', DIM_STYLE)
      .setOrigin(0.5, 1);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  /**
   * 캔버스가 창 크기를 따라가므로 좌표를 매번 다시 계산한다.
   * 월드가 정수배로 확대되는 만큼 UI도 같이 키워야 화면이 따로 놀지 않는다.
   */
  private layout(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    // 월드 줌 2~4 → UI 스케일 1~2
    const scale = Math.min(2, Math.max(1, computeCameraZoom(width, height) / 2));

    const pad = PAD * scale;
    const barHeight = TOP_BAR_HEIGHT * scale;

    this.roomText.setFontSize(TEXT_SIZE * scale);
    this.waveText.setFontSize(TEXT_SIZE * scale);
    this.coreLabel.setFontSize(DIM_SIZE * scale);
    this.debugText.setFontSize(DIM_SIZE * scale);
    this.helpText.setFontSize(DIM_SIZE * scale);

    this.topBar.setSize(width, barHeight);
    this.roomText.setPosition(pad, 5 * scale);
    this.waveText.setPosition(width - pad, 5 * scale);

    const coreY = barHeight + 10 * scale;
    this.coreLabel.setPosition(pad, coreY - 3 * scale);
    this.coreBarBack.setPosition(pad + CORE_LABEL_WIDTH * scale, coreY);
    this.coreBarBack.setSize(CORE_BAR_WIDTH * scale, CORE_BAR_HEIGHT * scale);
    this.coreBar.setPosition(pad + CORE_LABEL_WIDTH * scale, coreY);
    this.coreBar.setSize(CORE_BAR_WIDTH * scale, CORE_BAR_HEIGHT * scale);

    this.partyTexts.forEach((text, index) => {
      text.setFontSize(TEXT_SIZE * scale);
      text.setPosition(width - pad, coreY - 4 * scale + index * PARTY_LINE_HEIGHT * scale);
    });

    this.debugText.setPosition(pad, height - 22 * scale);
    this.helpText.setPosition(width / 2, height - 8 * scale);

    this.uiScale = scale;
  }

  update(): void {
    const snapshot = this.connection.getSnapshot();
    const { status } = snapshot;

    const coreRatio = status.coreMaxHp > 0 ? status.coreHp / status.coreMaxHp : 1;
    this.coreBar.width = Math.max(0, CORE_BAR_WIDTH * this.uiScale * coreRatio);
    // 코어가 위험하면 색으로 먼저 알린다 — 숫자를 읽기 전에 눈에 들어와야 한다.
    this.coreBar.fillColor = coreRatio > 0.3 ? 0x6fd08c : 0xd9756b;
    this.coreLabel.setText(`CORE ${Math.ceil(status.coreHp)}`);

    this.waveText.setText(describePhase(status, snapshot.players.length));

    snapshot.players.forEach((player, index) => {
      const text = this.partyTexts[index];
      if (!text) return;
      const isMe = player.id === this.connection.sessionId;
      const down = player.hp <= 0;
      text.setText(`${isMe ? '▸ ' : ''}${player.nickname} ${down ? '다운' : Math.ceil(player.hp)}`);
      text.setColor(down ? DOWN_COLOR : isMe ? ACCENT : '#cfd6e4');
    });

    for (let i = snapshot.players.length; i < this.partyTexts.length; i += 1) {
      this.partyTexts[i]?.setText('');
    }

    const me = snapshot.players.find((player) => player.id === this.connection.sessionId);
    this.debugText.setText(
      me
        ? `x:${me.x.toFixed(0)} y:${me.y.toFixed(0)} mob:${snapshot.monsters.length} proj:${snapshot.projectiles.length}`
        : '동기화 대기 중...',
    );

    // 낮에만 스킵 안내를 띄운다 — 밤에는 쓸 수 없는 조작이라 보여줄 이유가 없다.
    this.helpText.setText(
      status.wavePhase === 'day'
        ? `WASD 이동 · 좌클릭 사격 · [V] 낮 넘기기 ${status.skipVoteCount}/${snapshot.players.length}`
        : 'WASD 이동 · 좌클릭 사격 · ESC 나가기',
    );
  }
}

/**
 * 상단 우측 문구. 승패가 나면 그것만 알린다.
 *
 * `currentWave`는 이미 1부터 센다(WaveManager: waveIndex + 1). 낮은 "다음 웨이브를
 * 준비하는 시간"이라 +1해서 보여주고, 밤은 진행 중인 웨이브 번호를 그대로 쓴다.
 * 첫 낮은 currentWave가 0이라 자연스럽게 "WAVE 1 준비"가 된다.
 */
function describePhase(status: WorldStatus, playerCount: number): string {
  switch (status.wavePhase) {
    case 'victory':
      return '★ 방어 성공';
    case 'defeat':
      return '✖ 코어 파괴됨';
    case 'night':
      return `WAVE ${status.currentWave}  ·  밤`;
    default:
      return `WAVE ${status.currentWave + 1} 준비  ·  낮  ${status.skipVoteCount}/${playerCount}`;
  }
}
