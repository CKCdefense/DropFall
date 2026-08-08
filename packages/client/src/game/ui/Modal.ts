import Phaser from 'phaser';
import { FRAME_INSET, buttonBox, frameBox, setButtonHighlighted } from './uiFrame';
import { BOTTOM_BAR_RESERVED } from './QuickSlotBar';
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
/** 창이 화면 가장자리에 딱 붙지 않게 남기는 여백. */
const MIN_SCREEN_MARGIN = 8;
/** 구역 상자 배경. 내용 판(BOARD_FILL)보다 살짝 밝아 "판 위에 얹힌 상자"로 읽힌다. */
const SECTION_FILL = 0x171a22;
/**
 * 패널 테두리와 콘텐츠 사이 여백. 돌 프레임의 테두리 두께(FRAME_INSET)보다 커야
 * 글자가 테두리 위로 올라타지 않는다.
 */
const PAD = FRAME_INSET + 4;
/** 제목 줄 아래에서 콘텐츠가 시작되는 y 오프셋(패널 기준). 제목 줄 = 드래그 손잡이. */
const CONTENT_TOP = PAD + 18;

/**
 * 탭 줄 — **서류철 탭**이다. 버튼이 아니라 "내용 판에 붙은 색인표"로 보여야 한다.
 *
 * 그래서 (1) 선택된 탭은 내용 판과 **같은 색으로 이어 붙고**, (2) 선택되지 않은 탭은
 * 아래로 조금 내려앉아 뒤에 겹쳐 있는 것처럼 보인다. 나중에 9-slice 그림을 끼울 때도
 * 이 구조(높이·겹침)는 그대로 쓴다.
 */
const TAB_HEIGHT = 52;
const TAB_GAP = 4;
/** 선택 안 된 탭이 아래로 내려앉는 정도(px). 서류철에서 뒤에 밀린 탭을 흉내낸다. */
const TAB_INACTIVE_SINK = 6;
/** 탭 라벨 좌우 여백. 탭 폭은 글자 길이에 맞춘다 — 균등 분할하면 버튼 줄처럼 보인다. */
const TAB_LABEL_PAD = 30;
/**
 * 탭 글자는 본문(11px)의 정수 2배를 쓴다. 탭은 창에서 제일 먼저 읽어야 하는 요소인데
 * 본문 크기로 두면 커진 탭 판 안에서 글자만 작게 떠 보인다. 픽셀 폰트라 1.5배 같은
 * 중간값은 획이 뭉개지므로 정수배 외의 선택지가 없다(theme.ts 참고).
 */
const TAB_FONT_SIZE = SIZE_BODY * 2;
/** 선택된 탭이 내용 판 위로 겹쳐 들어가는 깊이(px). 이만큼 경계선이 지워져 하나로 이어진다. */
const TAB_SEAM = 2;

/** 내용 판(탭 아래의 큰 상자) 안쪽 여백. */
const BOARD_PAD = 12;
/** 내용 판 배경 — 창 바탕보다 한 톤 어둡게 해서 "판" 위에 올려둔 느낌을 준다. */
const BOARD_FILL = 0x0f1117;

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
    /** 쓸 수 있는 세로 높이. 아래쪽에 붙는 구역(상세/버튼)이 이 값에서 거꾸로 잡힌다. */
    readonly height = 0,
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
    return new PanelBuilder(this.scene, this.container, width, this.height);
  }

  /**
   * 구역 상자 — 와이어프레임의 "테두리 안에 묶인 한 덩어리". 격자·상세처럼 성격이 다른
   * 묶음을 눈으로 갈라 준다. 상자는 배경만 그리고, 안의 내용은 호출부가 같은 좌표계로
   * 이어서 그린다(컨테이너를 또 만들면 좌표가 두 겹이 되어 오히려 헷갈린다).
   */
  addSection(x: number, y: number, width: number, height: number): Phaser.GameObjects.Rectangle {
    const box = this.scene.add
      .rectangle(x, y, width, height, SECTION_FILL, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    this.container.add(box);
    return box;
  }

  /** 구역 안쪽 제목. 작은 글씨로 상자 좌상단에 붙인다. */
  addSectionTitle(x: number, y: number, label: string): Phaser.GameObjects.Text {
    const text = this.scene.add.text(x, y, label, {
      fontFamily: FONT_SMALL,
      fontSize: `${SIZE_SMALL}px`,
      color: DIM_TEXT,
    });
    this.container.add(text);
    return text;
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
  ): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle {
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
  protected contentWidth: number;
  /** content 안에서 쓸 수 있는 세로 높이. 탭 페이지가 판을 꽉 채워 배치할 때 쓴다. */
  protected readonly contentHeight: number;

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
    this.panelWidth = Math.min(opts.width, scene.scale.width - MIN_SCREEN_MARGIN * 2);
    // 창은 **하단 바 위 공간보다 커질 수 없다.** 더 크면 퀵슬롯을 덮어서, 창고에서
    // 끌어다 놓는 조작 자체가 막힌다(실제로 그랬다 — 640짜리 창 + 140짜리 바가
    // 664 화면에 함께 들어가지 않는다). 안쪽 내용은 이 높이에서 다시 계산되므로
    // 구역들이 알아서 줄어든다(§PanelBuilder.height).
    this.panelHeight = Math.min(
      opts.height,
      scene.scale.height - BOTTOM_BAR_RESERVED - MIN_SCREEN_MARGIN * 2,
    );
    this.contentWidth = this.panelWidth - PAD * 2;

    this.root = scene.add
      .container(
        scene.scale.width / 2 - this.panelWidth / 2,
        scene.scale.height / 2 - this.panelHeight / 2,
      )
      .setDepth(DEPTH_PANEL)
      .setVisible(false);

    // 바깥 테두리는 돌 프레임(9-slice)이다. 에셋이 없으면 예전처럼 단색 사각형이 온다.
    const panel = frameBox(scene, 0, 0, this.panelWidth, this.panelHeight);
    // 패널 위 클릭이 아래 요소(퀵슬롯 등)로 떨어지지 않게 이벤트를 먹는다.
    panel.setInteractive();
    // 돌 프레임은 안쪽이 밝은 회색이라 그 위에 HUD의 어두운 글자를 얹으면 읽히지 않는다.
    // **테두리만 남기고 안쪽을 어두운 판으로 덮어** 나머지 HUD와 같은 톤을 유지한다.
    // 에셋이 없을 때(프레임이 사각형 폴백)는 같은 색이라 아무 차이가 없다.
    const backdrop = scene.add
      .rectangle(
        FRAME_INSET,
        FRAME_INSET,
        this.panelWidth - FRAME_INSET * 2,
        this.panelHeight - FRAME_INSET * 2,
        PANEL_FILL,
        PANEL_ALPHA,
      )
      .setOrigin(0, 0);

    const tabbed = opts.tabs !== undefined && opts.tabs.length > 0;
    const headerHeight = tabbed ? PAD + TAB_HEIGHT : CONTENT_TOP;
    // 내용 판. 탭이 이 판의 윗변에 얹히므로 판을 먼저 잡고 탭을 그 위에 그린다.
    const boardTop = PAD + TAB_HEIGHT;
    const boardHeight = this.panelHeight - PAD - boardTop;
    const boardWidth = this.panelWidth - PAD * 2;

    // 머리줄 전체가 드래그 손잡이다. 탭 모달에서는 탭 버튼이 이 위에 얹히므로(나중에
    // 추가되는 자식이 위에 온다) 탭을 눌러도 창이 끌려가지 않는다.
    const titleBar = scene.add
      .rectangle(0, 0, this.panelWidth - 24, headerHeight, PANEL_FILL, 0.01)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    titleBar.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragOffset = { x: pointer.x - this.root.x, y: pointer.y - this.root.y };
    });
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onDragMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onDragEnd, this);

    const closeButton = scene.add
      .text(this.panelWidth - PAD, PAD, 'X', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    closeButton.on('pointerover', () => closeButton.setColor(ACCENT));
    closeButton.on('pointerout', () => closeButton.setColor(DIM_TEXT));
    closeButton.on('pointerdown', () => this.close());

    this.contentHeight = tabbed
      ? boardHeight - BOARD_PAD * 2
      : this.panelHeight - CONTENT_TOP - PAD;
    if (tabbed) this.contentWidth = boardWidth - BOARD_PAD * 2;

    this.content = scene.add.container(
      tabbed ? PAD + BOARD_PAD : PAD,
      tabbed ? boardTop + BOARD_PAD : CONTENT_TOP,
    );
    this.builder = new PanelBuilder(scene, this.content, this.contentWidth, this.contentHeight);
    this.root.add([panel, backdrop, titleBar]);

    if (tabbed) {
      const board = scene.add
        .rectangle(PAD, boardTop, boardWidth, boardHeight, BOARD_FILL, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE);
      this.root.add(board);
      this.buildTabs(scene, opts.tabs!, boardTop);
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
  private buildTabs(scene: Phaser.Scene, tabs: readonly string[], boardTop: number): void {
    let x = PAD;

    tabs.forEach((label, index) => {
      // 폭은 글자 길이에 맞춘다. 창 폭을 균등 분할하면 탭이 아니라 버튼 줄로 보인다.
      const text = scene.add
        .text(0, 0, label, {
          fontFamily: FONT,
          fontSize: `${TAB_FONT_SIZE}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);
      const tabWidth = Math.ceil(text.width) + TAB_LABEL_PAD * 2;

      // 선택되면 판과 맞닿아 이어지고, 아니면 아래로 내려앉아 뒤에 밀린 것처럼 보인다.
      // 두 상태의 위아래 크기가 여기서 정해지고, showTab이 그 사이를 오간다.
      const box = scene.add
        .rectangle(x, PAD, tabWidth, TAB_HEIGHT, BOARD_FILL, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });
      box.on('pointerdown', () => this.showTab(index));

      text.setPosition(x + tabWidth / 2, PAD + TAB_HEIGHT / 2);

      const page = scene.add.container(0, 0);
      this.content.add(page);
      this.pages.push(page);
      this.pageBuilders.push(
        new PanelBuilder(scene, page, this.contentWidth, this.contentHeight),
      );
      this.tabBoxes.push(box);
      this.tabLabels.push(text);
      this.root.add([box, text]);

      x += tabWidth + TAB_GAP;
    });

    this.tabBoardTop = boardTop;
    this.showTab(0);
  }

  /** 내용 판의 윗변 y. 탭이 이 선에 맞춰 붙거나 내려앉는다. */
  private tabBoardTop = 0;

  /** 탭 전환. 같은 탭을 다시 눌러도 안전하다(멱등). */
  showTab(index: number): void {
    if (index < 0 || index >= this.pages.length) return;
    this.activeTab = index;
    this.pages.forEach((page, i) => page.setVisible(i === index));

    this.tabBoxes.forEach((box, i) => {
      const active = i === index;
      const rect = box as Phaser.GameObjects.Rectangle;
      // 선택된 탭은 판 윗변을 TAB_SEAM만큼 덮어써서 경계선을 지운다 — 판과 한 몸으로
      // 이어져 보이는 게 서류철 탭의 핵심이다. 나머지는 아래로 내려앉는다.
      const top = active ? PAD : PAD + TAB_INACTIVE_SINK;
      const bottom = active ? this.tabBoardTop + TAB_SEAM : this.tabBoardTop;
      rect.setPosition(rect.x, top);
      rect.setSize(rect.width, bottom - top);
      rect.setFillStyle(active ? BOARD_FILL : PANEL_FILL, 1);
      rect.setStrokeStyle(1, active ? ACCENT_STROKE : PANEL_STROKE);
      // 선택된 탭이 판 위로 올라와야 경계선이 실제로 가려진다.
      this.root.bringToTop(rect);
    });

    this.tabLabels.forEach((text, i) => {
      const active = i === index;
      text.setColor(active ? ACCENT : DIM_TEXT);
      text.setY((active ? PAD : PAD + TAB_INACTIVE_SINK) + TAB_HEIGHT / 2);
      this.root.bringToTop(text);
    });
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

  /**
   * 창을 다시 가운데로 놓는다. **하단 HUD가 차지하는 높이를 빼고** 그 위 공간의 가운데다 —
   * 창이 커지고 퀵슬롯이 3배가 되면서 기본 가운데 정렬로는 창이 슬롯을 덮어, 창고에서
   * 퀵슬롯으로 끌어다 놓는 조작 자체가 막혔다(실제로 그랬다).
   *
   * 화면 크기가 바뀔 때도 다시 부른다 — 예전엔 생성 시점에 한 번만 놓아서, 창을 열어 둔
   * 채 창 크기를 바꾸면 화면 밖으로 밀려났다.
   */
  recenter(screenWidth: number, screenHeight: number, bottomReserved: number): void {
    const available = Math.max(this.panelHeight, screenHeight - bottomReserved);
    this.root.setPosition(
      Math.round(screenWidth / 2 - this.panelWidth / 2),
      Math.max(0, Math.round((available - this.panelHeight) / 2)),
    );
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
  ): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle {
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
