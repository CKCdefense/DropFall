import Phaser from 'phaser';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, FONT_SMALL, PANEL_FILL, PANEL_STROKE, SIZE_BODY, SIZE_SMALL } from './theme';

/** ACCENT('#6fd08c')의 숫자판. setStrokeStyle은 숫자 색만 받는다(텍스트 색과 표현이 다름). */
const ACCENT_STROKE = 0x6fd08c;

/** 모달은 HUD의 다른 어떤 요소보다도 위에 그려져야 한다. */
const DEPTH_BACKDROP = 20000;
const DEPTH_PANEL = 20001;

const BACKDROP_COLOR = 0x08090c;
const BACKDROP_ALPHA = 0.6;
const PANEL_ALPHA = 0.95;
/** 패널 테두리와 콘텐츠 사이 여백. */
const PAD = 10;
/** 제목 줄 아래에서 콘텐츠가 시작되는 y 오프셋(패널 기준). */
const CONTENT_TOP = 28;

export interface ModalOptions {
  title: string;
  width: number;
  height: number;
}

/**
 * 인게임 모달 공용 뼈대 — 배경 차단막 + 테두리 패널 + 제목 + 닫기 버튼.
 *
 * HudScene의 다른 요소와 마찬가지로 순수 Phaser GameObject로만 구성한다(DOM 아님).
 * 로비의 DOM 모달(LobbyApp.ts)과는 렌더링 레이어 자체가 달라서 그 패턴을 그대로
 * 옮기지 않는다 — 여기서는 panelBox(HudScene.ts)와 같은 모양을 그대로 재현한다.
 *
 * 각 화면(CoreModal 등)은 이 클래스를 상속해 content 컨테이너에 자기 행/버튼을 채운다.
 */
export class Modal {
  protected readonly scene: Phaser.Scene;
  /** 패널 좌상단(패딩 포함) 기준으로 자식을 붙이는 컨테이너. 상속 클래스가 채운다. */
  readonly content: Phaser.GameObjects.Container;
  /** content 안에서 쓸 수 있는 가로 폭(패딩 뺀 값). 행/버튼 배치에 쓴다. */
  protected readonly contentWidth: number;

  private readonly backdrop: Phaser.GameObjects.Rectangle;
  private readonly panel: Phaser.GameObjects.Rectangle;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly closeButton: Phaser.GameObjects.Text;
  private readonly panelLeft: number;
  private readonly panelTop: number;
  private readonly panelWidth: number;
  private readonly panelHeight: number;
  private opened = false;

  constructor(scene: Phaser.Scene, opts: ModalOptions) {
    this.scene = scene;
    this.panelWidth = opts.width;
    this.panelHeight = opts.height;
    this.panelLeft = scene.scale.width / 2 - opts.width / 2;
    this.panelTop = scene.scale.height / 2 - opts.height / 2;
    this.contentWidth = opts.width - PAD * 2;

    this.backdrop = scene.add
      .rectangle(0, 0, scene.scale.width, scene.scale.height, BACKDROP_COLOR, BACKDROP_ALPHA)
      .setOrigin(0, 0)
      .setDepth(DEPTH_BACKDROP)
      .setInteractive();
    // 패널 영역 밖을 클릭했을 때만 닫는다. 패널 자체를 interactive로 잡아 전파를 막는
    // 대신, 클릭 좌표가 패널 사각형 안인지를 직접 검사한다 — 이벤트 버블링에 기대지 않아
    // 버튼 클릭이 우연히 차단막까지 전달돼도(둘 다 히트 테스트를 통과하므로) 안전하다.
    this.backdrop.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isInsidePanel(pointer.x, pointer.y)) return;
      this.close();
    });

    this.panel = scene.add
      .rectangle(this.panelLeft, this.panelTop, opts.width, opts.height, PANEL_FILL, PANEL_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      .setDepth(DEPTH_PANEL);

    this.titleText = scene.add
      .text(this.panelLeft + PAD, this.panelTop + PAD, opts.title, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
      .setDepth(DEPTH_PANEL);

    this.closeButton = scene.add
      .text(this.panelLeft + opts.width - PAD, this.panelTop + PAD, 'X', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH_PANEL)
      .setInteractive({ useHandCursor: true });
    this.closeButton.on('pointerover', () => this.closeButton.setColor(ACCENT));
    this.closeButton.on('pointerout', () => this.closeButton.setColor(DIM_TEXT));
    this.closeButton.on('pointerdown', () => this.close());

    this.content = scene.add
      .container(this.panelLeft + PAD, this.panelTop + CONTENT_TOP)
      .setDepth(DEPTH_PANEL);

    this.setAllVisible(false);
  }

  open(): void {
    this.opened = true;
    this.setAllVisible(true);
  }

  close(): void {
    this.opened = false;
    this.setAllVisible(false);
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** 레이블 + 값을 한 줄에 놓는다(가격/자원/에너지 같은 정보 행용). */
  protected addRow(y: number, label: string, value: string): Phaser.GameObjects.Text {
    const labelText = this.scene.add.text(0, y, label, {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    const valueText = this.scene.add
      .text(this.contentWidth, y, value, { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT })
      .setOrigin(1, 0);
    this.content.add([labelText, valueText]);
    return valueText;
  }

  /** 테두리 상자 + 가운데 정렬 텍스트 버튼. 호버 시 테두리를 강조색으로 바꾼다. */
  protected addButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Rectangle {
    const box = this.scene.add
      .rectangle(x, y, width, height, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      .setInteractive({ useHandCursor: true });
    const text = this.scene.add
      .text(x + width / 2, y + height / 2, label, { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT })
      .setOrigin(0.5, 0.5);
    box.on('pointerover', () => box.setStrokeStyle(1, ACCENT_STROKE));
    box.on('pointerout', () => box.setStrokeStyle(1, PANEL_STROKE));
    box.on('pointerdown', () => onClick());
    this.content.add([box, text]);
    return box;
  }

  /**
   * 상점/제작 칸 하나. addButton과 달리 라벨을 칸 아래쪽에 작게 붙인다(가격 등).
   * 반환한 사각형에 나중에 setStrokeStyle을 다시 걸면 선택 강조로 쓸 수 있다.
   */
  protected addSlot(
    x: number,
    y: number,
    size: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Rectangle {
    const box = this.scene.add
      .rectangle(x, y, size, size, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      .setInteractive({ useHandCursor: true });
    const text = this.scene.add
      .text(x + size / 2, y + size - 3, label, { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: DIM_TEXT })
      .setOrigin(0.5, 1);
    box.on('pointerover', () => box.setFillStyle(PANEL_FILL, 1));
    box.on('pointerout', () => box.setFillStyle(PANEL_FILL, 0.9));
    box.on('pointerdown', () => onClick());
    this.content.add([box, text]);
    return box;
  }

  private isInsidePanel(x: number, y: number): boolean {
    return (
      x >= this.panelLeft &&
      x <= this.panelLeft + this.panelWidth &&
      y >= this.panelTop &&
      y <= this.panelTop + this.panelHeight
    );
  }

  private setAllVisible(visible: boolean): void {
    this.backdrop.setVisible(visible);
    this.panel.setVisible(visible);
    this.titleText.setVisible(visible);
    this.closeButton.setVisible(visible);
    this.content.setVisible(visible);
  }
}
