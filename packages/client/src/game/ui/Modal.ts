import Phaser from 'phaser';
import { FRAME_INSET, buttonBox, frameBox, setButtonHighlighted } from './uiFrame';
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
/** 닫기(X) 버튼이 차지하는 오른쪽 여백. 탭이 이 아래로 깔리면 마지막 탭을 못 누른다. */
const CLOSE_BUTTON_SPACE = 20;
/**
 * 패널 테두리와 콘텐츠 사이 여백. 돌 프레임의 테두리 두께(FRAME_INSET)보다 커야
 * 글자가 테두리 위로 올라타지 않는다.
 */
const PAD = FRAME_INSET + 4;
/** 제목 줄 아래에서 콘텐츠가 시작되는 y 오프셋(패널 기준). 제목 줄 = 드래그 손잡이. */
const CONTENT_TOP = PAD + 18;

/** 탭 한 칸의 높이와 칸 사이 간격. 와이어프레임의 "상단 버튼 탭" 줄이다. */
const TAB_HEIGHT = 30;
const TAB_GAP = 4;
/** 탭 줄과 내용 사이 간격. */
const TAB_CONTENT_GAP = 10;

export interface ModalOptions {
  title: string;
  width: number;
  height: number;
  /**
   * 있으면 제목 줄 대신 **상단 탭 줄**이 생기고, 탭 수만큼 페이지가 만들어진다.
   * 페이지는 `page(index)`로 꺼내 각자 채운다(§TabbedModal).
   */
  tabs?: readonly string[];
}

/**
 * 컨테이너 하나에 표준 UI 조각(행·버튼·칸)을 찍어내는 도구.
 *
 * 예전엔 이 메서드들이 Modal의 protected 메서드였다. 탭 모달이 생기면서 **한 창 안에
 * 여러 페이지**를 담아야 했는데, 그러려면 "모달"이 아니라 "임의의 컨테이너"에 대고
 * 같은 조각을 그릴 수 있어야 한다. Modal은 이제 자기 콘텐츠용 빌더를 하나 들고 그
 * 메서드를 그대로 위임한다 — 기존 모달들은 손댈 필요가 없다.
 */
export class PanelBuilder {
  constructor(
    readonly scene: Phaser.Scene,
    readonly container: Phaser.GameObjects.Container,
    /** 쓸 수 있는 가로 폭. 오른쪽 정렬·전체폭 버튼이 이 값을 기준으로 잡힌다. */
    readonly width: number,
  ) {}

  add(object: Phaser.GameObjects.GameObject): void {
    this.container.add(object);
  }

  /**
   * 같은 컨테이너에 **더 좁은 폭**으로 그리는 빌더. 오른쪽 정렬(값 행)이나 전체폭 버튼이
   * 창 끝까지 늘어나면 안 되는 구역에 쓴다 — 넓은 탭에서 정보 행이 화면 반대편까지
   * 벌어져 읽기 힘들었다.
   */
  narrow(width: number): PanelBuilder {
    return new PanelBuilder(this.scene, this.container, width);
  }

  /** 레이블 + 값을 한 줄에 놓는다(가격/자원/에너지 같은 정보 행용). */
  addRow(y: number, label: string, value: string): Phaser.GameObjects.Text {
    const labelText = this.scene.add.text(0, y, label, {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    const valueText = this.scene.add
      .text(this.width, y, value, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
      .setOrigin(1, 0);
    this.container.add([labelText, valueText]);
    return valueText;
  }

  /**
   * 돌 프레임 버튼 + 가운데 정렬 텍스트. 에셋이 없으면 사각형 + 1px 테두리로 떨어진다
   * (uiFrame.buttonBox) — 어느 쪽이든 호버 표현은 같은 함수가 처리한다.
   */
  addButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.GameObject {
    const box = buttonBox(this.scene, x, y, width, height);
    box.setInteractive({ useHandCursor: true });
    const text = this.scene.add
      .text(x + width / 2, y + height / 2, label, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
      .setOrigin(0.5, 0.5);
    box.on('pointerover', () => setButtonHighlighted(box, true, ACCENT_STROKE));
    box.on('pointerout', () => setButtonHighlighted(box, false, ACCENT_STROKE));
    box.on('pointerdown', () => onClick());
    this.container.add([box, text]);
    return box;
  }

  /**
   * 상점/제작 칸 하나. addButton과 달리 라벨을 칸 아래쪽에 작게 붙인다(가격 등).
   * 반환한 사각형에 나중에 setStrokeStyle을 다시 걸면 선택 강조로 쓸 수 있다.
   */
  addSlot(
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
    this.container.add([box, text]);
    return box;
  }
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

  protected readonly builder: PanelBuilder;

  /** 탭 모달일 때만 채워진다 — 탭 수만큼의 페이지와 각 페이지용 빌더. */
  private readonly pages: Phaser.GameObjects.Container[] = [];
  private readonly pageBuilders: PanelBuilder[] = [];
  private readonly tabBoxes: (Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle)[] = [];
  private readonly tabLabels: Phaser.GameObjects.Text[] = [];
  private activeTab = 0;

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

    // 바깥 테두리는 돌 프레임(9-slice)이다. 에셋이 없으면 예전처럼 단색 사각형이 온다.
    const panel = frameBox(scene, 0, 0, opts.width, opts.height);
    // 패널 위 클릭이 아래 요소(퀵슬롯 등)로 떨어지지 않게 이벤트를 먹는다.
    panel.setInteractive();
    // 돌 프레임은 안쪽이 밝은 회색이라 그 위에 HUD의 어두운 글자를 얹으면 읽히지 않는다.
    // **테두리만 남기고 안쪽을 어두운 판으로 덮어** 나머지 HUD와 같은 톤을 유지한다.
    // 에셋이 없을 때(프레임이 사각형 폴백)는 같은 색이라 아무 차이가 없다.
    const backdrop = scene.add
      .rectangle(
        FRAME_INSET,
        FRAME_INSET,
        opts.width - FRAME_INSET * 2,
        opts.height - FRAME_INSET * 2,
        PANEL_FILL,
        PANEL_ALPHA,
      )
      .setOrigin(0, 0);

    const tabbed = opts.tabs !== undefined && opts.tabs.length > 0;
    const headerHeight = tabbed ? PAD + TAB_HEIGHT : CONTENT_TOP;

    // 머리줄 전체가 드래그 손잡이다. 탭 모달에서는 탭 버튼이 이 위에 얹히므로(나중에
    // 추가되는 자식이 위에 온다) 탭을 눌러도 창이 끌려가지 않는다.
    const titleBar = scene.add
      .rectangle(0, 0, opts.width - 24, headerHeight, PANEL_FILL, 0.01)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    titleBar.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragOffset = { x: pointer.x - this.root.x, y: pointer.y - this.root.y };
    });
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onDragMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onDragEnd, this);

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

    this.content = scene.add.container(PAD, tabbed ? headerHeight + TAB_CONTENT_GAP : CONTENT_TOP);
    this.builder = new PanelBuilder(scene, this.content, this.contentWidth);
    this.root.add([panel, backdrop, titleBar]);

    if (tabbed) {
      this.buildTabs(scene, opts.tabs!, opts.width);
    } else {
      this.root.add(
        scene.add.text(PAD, PAD, opts.title, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          color: BODY_TEXT,
        }),
      );
    }

    this.root.add([closeButton, this.content]);
  }

  /**
   * 상단 탭 줄. 탭 하나가 페이지 하나를 켠다 — 페이지는 content 안의 컨테이너라 모달을
   * 끌어 옮기면 같이 따라간다.
   *
   * 닫기 버튼 자리를 피해 폭을 나눈다. 탭이 X 밑으로 깔리면 마지막 탭을 못 누른다.
   */
  private buildTabs(scene: Phaser.Scene, tabs: readonly string[], panelWidth: number): void {
    const stripWidth = panelWidth - PAD * 2 - CLOSE_BUTTON_SPACE;
    const tabWidth = (stripWidth - TAB_GAP * (tabs.length - 1)) / tabs.length;

    tabs.forEach((label, index) => {
      const x = PAD + index * (tabWidth + TAB_GAP);
      const box = buttonBox(scene, x, PAD, tabWidth, TAB_HEIGHT);
      box.setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => this.showTab(index));

      const text = scene.add
        .text(x + tabWidth / 2, PAD + TAB_HEIGHT / 2, label, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);

      const page = scene.add.container(0, 0);
      this.content.add(page);
      this.pages.push(page);
      this.pageBuilders.push(new PanelBuilder(scene, page, this.contentWidth));
      this.tabBoxes.push(box);
      this.tabLabels.push(text);
      this.root.add([box, text]);
    });

    this.showTab(0);
  }

  /** 탭 전환. 같은 탭을 다시 눌러도 안전하다(멱등). */
  showTab(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.activeTab = index;
    this.pages.forEach((page, i) => page.setVisible(i === index));
    this.tabBoxes.forEach((box, i) => setButtonHighlighted(box, i === index, ACCENT_STROKE));
    // 선택된 탭만 글자를 강조색으로 — 9-slice 텍스처 차이만으로는 눈에 잘 안 띈다.
    this.tabLabels.forEach((text, i) => text.setColor(i === index ? ACCENT : BODY_TEXT));
  }

  /** 지금 열려 있는 탭 번호. 드래그앤드롭이 "이 페이지가 보이는가"를 물을 때 쓴다. */
  get currentTab(): number {
    return this.activeTab;
  }

  /** 탭 페이지에 UI를 그릴 빌더. 상속 클래스가 페이지를 채울 때 쓴다. */
  protected pageBuilder(index: number): PanelBuilder {
    return this.pageBuilders[index]!;
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
    this.builder.add(object);
  }

  /** 레이블 + 값을 한 줄에 놓는다(가격/자원/에너지 같은 정보 행용). */
  protected addRow(y: number, label: string, value: string): Phaser.GameObjects.Text {
    return this.builder.addRow(y, label, value);
  }

  /** 돌 프레임 버튼 + 가운데 정렬 텍스트. */
  protected addButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.GameObject {
    return this.builder.addButton(x, y, width, height, label, onClick);
  }

  /** 상점/제작 칸 하나. */
  protected addSlot(
    x: number,
    y: number,
    size: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Rectangle {
    return this.builder.addSlot(x, y, size, label, onClick);
  }
}
