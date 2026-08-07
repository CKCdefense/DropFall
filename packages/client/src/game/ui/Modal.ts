import Phaser from 'phaser';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
} from './theme';

/** ACCENT('#6fd08c')의 숫자판. setStrokeStyle은 숫자 색만 받는다(텍스트 색과 표현이 다름). */
const ACCENT_STROKE = 0x6fd08c;

/** 모달은 HUD의 다른 어떤 요소보다도 위에 그려져야 한다. */
const DEPTH_PANEL = 20001;

const PANEL_ALPHA = 0.95;
/** 패널 테두리와 콘텐츠 사이 여백. */
const PAD = 10;
/** 제목 줄 아래에서 콘텐츠가 시작되는 y 오프셋(패널 기준). 제목 줄 = 드래그 손잡이. */
const CONTENT_TOP = 28;

export interface ModalOptions {
  title: string;
  width: number;
  height: number;
}

/**
 * 인게임 모달 공용 뼈대 — 테두리 패널 + 제목 줄(드래그 손잡이) + 닫기 버튼.
 *
 * **차단막(어두운 배경)이 없다.** 코어 창고를 연 채로 퀵슬롯 HUD와 아이템을 주고받아야
 * 해서, 모달이 화면을 점유하는 "다른 화면"이 아니라 **게임 위에 떠 있는 창**이어야 한다.
 * 같은 이유로 제목 줄을 잡아 원하는 위치로 끌 수 있다 — 퀵슬롯을 가리면 옮기면 된다.
 *
 * 모달이 떠 있는 동안 좌클릭이 무기 발사로 새는 문제는 여기가 아니라 HudScene의 입력
 * 차단 콜백(HUD_BLOCK_KEY)이 막는다 — 발사는 이벤트가 아니라 폴링이라 패널을
 * interactive로 잡는 것만으로는 안 막힌다.
 *
 * 모든 조각이 root 컨테이너 하나에 담긴다 — 드래그 이동이 setPosition 한 번으로 끝나고,
 * 안의 칸들은 월드 변환(getWorldTransformMatrix)으로 위치를 물으므로 저절로 따라온다.
 */
export class Modal {
  protected readonly scene: Phaser.Scene;
  /** 패널 좌상단(패딩 포함) 기준으로 자식을 붙이는 컨테이너. 상속 클래스가 채운다. */
  readonly content: Phaser.GameObjects.Container;
  /** content 안에서 쓸 수 있는 가로 폭(패딩 뺀 값). 행/버튼 배치에 쓴다. */
  protected readonly contentWidth: number;

  private readonly root: Phaser.GameObjects.Container;
  private readonly panelWidth: number;
  private readonly panelHeight: number;
  private opened = false;
  /** 드래그 중이면 포인터와 패널 좌상단의 간격. 놓으면 null. */
  private dragOffset: { x: number; y: number } | null = null;

  constructor(scene: Phaser.Scene, opts: ModalOptions) {
    this.scene = scene;
    this.panelWidth = opts.width;
    this.panelHeight = opts.height;
    this.contentWidth = opts.width - PAD * 2;

    this.root = scene.add
      .container(
        scene.scale.width / 2 - opts.width / 2,
        scene.scale.height / 2 - opts.height / 2,
      )
      .setDepth(DEPTH_PANEL)
      .setVisible(false);

    const panel = scene.add
      .rectangle(0, 0, opts.width, opts.height, PANEL_FILL, PANEL_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      // 패널 위 클릭이 아래 요소(퀵슬롯 등)로 떨어지지 않게 이벤트를 먹는다.
      .setInteractive();

    // 제목 줄 전체가 드래그 손잡이다. 닫기 버튼 자리(오른쪽 24px)는 비워둔다.
    const titleBar = scene.add
      .rectangle(0, 0, opts.width - 24, CONTENT_TOP, PANEL_FILL, 0.01)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    titleBar.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragOffset = { x: pointer.x - this.root.x, y: pointer.y - this.root.y };
    });
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onDragMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onDragEnd, this);

    const titleText = scene.add.text(PAD, PAD, opts.title, {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });

    const closeButton = scene.add
      .text(opts.width - PAD, PAD, 'X', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    closeButton.on('pointerover', () => closeButton.setColor(ACCENT));
    closeButton.on('pointerout', () => closeButton.setColor(DIM_TEXT));
    closeButton.on('pointerdown', () => this.close());

    this.content = scene.add.container(PAD, CONTENT_TOP);
    this.root.add([panel, titleBar, titleText, closeButton, this.content]);
  }

  private onDragMove(pointer: Phaser.Input.Pointer): void {
    if (!this.dragOffset) return;
    // 화면 밖으로 완전히 나가면 되찾을 방법이 없다 — 제목 줄이 남게 자른다.
    const x = Phaser.Math.Clamp(
      pointer.x - this.dragOffset.x,
      -this.panelWidth + 40,
      this.scene.scale.width - 40,
    );
    const y = Phaser.Math.Clamp(pointer.y - this.dragOffset.y, 0, this.scene.scale.height - 28);
    this.root.setPosition(x, y);
  }

  private onDragEnd(): void {
    this.dragOffset = null;
  }

  open(): void {
    this.opened = true;
    this.root.setVisible(true);
  }

  close(): void {
    this.opened = false;
    this.dragOffset = null;
    this.root.setVisible(false);
  }

  isOpen(): boolean {
    return this.opened;
  }

  /** 화면 좌표가 패널 위인지. HudScene이 "이 클릭은 게임이 아니라 UI"를 판정할 때 쓴다. */
  containsPoint(x: number, y: number): boolean {
    return (
      this.opened &&
      x >= this.root.x &&
      x <= this.root.x + this.panelWidth &&
      y >= this.root.y &&
      y <= this.root.y + this.panelHeight
    );
  }

  /** 임의의 오브젝트를 모달 내용에 붙인다. 표준 행/버튼으로 안 되는 격자 UI 등에 쓴다. */
  protected addContent(object: Phaser.GameObjects.GameObject): void {
    this.content.add(object);
  }

  /** 레이블 + 값을 한 줄에 놓는다(가격/자원/에너지 같은 정보 행용). */
  protected addRow(y: number, label: string, value: string): Phaser.GameObjects.Text {
    const labelText = this.scene.add.text(0, y, label, {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    const valueText = this.scene.add
      .text(this.contentWidth, y, value, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
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
      .text(x + width / 2, y + height / 2, label, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
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
      .text(x + size / 2, y + size - 3, label, {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
      })
      .setOrigin(0.5, 1);
    box.on('pointerover', () => box.setFillStyle(PANEL_FILL, 1));
    box.on('pointerout', () => box.setFillStyle(PANEL_FILL, 0.9));
    box.on('pointerdown', () => onClick());
    this.content.add([box, text]);
    return box;
  }
}
