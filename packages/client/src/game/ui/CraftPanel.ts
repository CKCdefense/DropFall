import Phaser from 'phaser';
import {
  craftingData,
  itemsData,
  type CraftRecipe,
  type InventorySlot,
} from '@dropfall/shared';
import {
  ACCENT,
  BODY_TEXT,
  DETAIL_MAX_HEIGHT,
  DETAIL_MIN_HEIGHT,
  DETAIL_RATIO,
  DIM_TEXT,
  FONT,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
} from './theme';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';
import { CostTag } from './costTag';
import { ICON_ENERGY, ICON_RESOURCE } from './hudBar';

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const SELECTED_STROKE = 0x6fd08c;
/** 재료가 모자랄 때의 붉은 글자. */
const LACKING_TEXT = '#d98a8a';

const SLOT_SIZE = 62;
const SLOT_GAP = 10;
const SLOT_COLS = 4;
const SECTION_PAD = 12;
const SECTION_GAP = 10;
/**
 * 티어 고르는 왼쪽 열. 버튼은 **상단 탭과 같은 어휘**로 그린다 — 돌 프레임(9-slice)
 * 버튼은 이 창 안에서 유일하게 다른 재질이라 눈에 걸렸고, 무엇보다 "지금 이 티어를
 * 보고 있다"를 색으로 말해주지 못했다. 탭처럼 초록 테두리 + 밝은 판이면 선택 상태가
 * 그대로 읽히고, 잠긴 티어는 흐리게 눌러 두면 된다.
 */
const TIER_WIDTH = 128;
const TIER_BUTTON_HEIGHT = 52;
const TIER_BUTTON_GAP = 10;
/** 티어 버튼 배경/테두리. Modal의 탭과 같은 값이다. */
const TIER_ACTIVE_FILL = 0x0f1117;
const TIER_IDLE_FILL = 0x14161d;

/** 카테고리 제목 줄 높이와 묶음 사이 간격. */
const CATEGORY_HEAD = 20;
const CATEGORY_GAP = 12;
/** 스크롤 막대 폭과 최소 길이. 목록이 넘칠 때만 나타난다. */
const SCROLL_WIDTH = 4;
const SCROLL_MIN = 24;
/**
 * 휠 한 칸에 움직이는 거리 = **한 줄**.
 *
 * 넘치는 부분을 마스크로 자르지 않고 **줄째로 숨기기** 때문이다(§cullList).
 * 마스크를 쓰려면 도형을 창 컨테이너 밖에 두고 창을 끌 때마다 월드 좌표를 다시
 * 맞춰야 하는데(컨테이너 안에 넣으면 부모 변환을 못 받아 엉뚱한 자리를 가린다 —
 * 실제로 그래서 목록이 통째로 사라졌다), 목록이 몇 줄뿐이라 그 복잡도를 살 이유가 없다.
 * 반 줄씩 움직이면 잘린 칸이 생기므로 한 줄씩 딱 떨어지게 움직인다.
 */
const SCROLL_STEP = SLOT_SIZE + SLOT_GAP;

/**
 * 제작 버튼 — 아래 띠의 **높이를 통째로** 쓰는 홀로그램 판(상점의 구매/리롤과 같은 재질).
 * 돌 프레임 32px짜리 작은 버튼은 이 창에서 유일하게 다른 재질인 데다, 정작 가장 자주
 * 누르는 것인데 가장 눈에 안 띄었다.
 */
const CRAFT_BUTTON_WIDTH = 116;

/** 진행 화살표와 상자들. "만들 것 → (시간) → 결과"를 한 줄로 읽히게 한다. */
const ARROW_LENGTH = 46;
const ARROW_SHAFT_HALF = 5;
const ARROW_HEAD_HALF = 11;
const ARROW_HEAD_LENGTH = 16;
/**
 * 왼쪽 그림 상자와 오른쪽 결과 상자는 **같은 크기**다. 예전엔 결과 상자만 52px이라
 * 왼쪽 그림보다 작아서, 한 줄로 읽혀야 할 "→" 관계가 크기 차이 때문에 어긋나 보였다.
 */
const BOX_SIZE = 84;
const BOX_ICON_INSET = 14;
const GAP = 10;
/** 아래 띠 글줄. 이름(22px) 아래로 세 줄. 상점 상세와 같은 규칙이다. */
const DETAIL_LINE_TOP = 26;
const DETAIL_LINE_GAP = 18;
/** 화살표 색: 아직 안 찬 부분(어둡게)과 찬 부분(흰색). */
const ARROW_TRACK = 0x2a2f3a;
const ARROW_FILL = 0xffffff;

/**
 * 목록을 가르는 갈래. **아이템 종류(items.json의 kind)로 나눈다** — 레시피에 분류를
 * 따로 적어두면 아이템을 옮길 때마다 두 곳을 고쳐야 한다.
 *
 * 무기(weapon)는 지금 전부 채집 도구라 '도구'로 부른다. 나중에 진짜 무기를 제작하게
 * 되면 여기서 갈래를 하나 더 내면 된다.
 */
const CATEGORIES: readonly { title: string; kinds: readonly string[] }[] = [
  { title: '도구', kinds: ['weapon'] },
  { title: '건설물', kinds: ['building'] },
  { title: '아이템', kinds: ['consumable'] },
];

/** 어느 갈래에도 안 걸린 것들이 모이는 자리. 새 종류가 생겨도 목록에서 사라지지 않는다. */
const OTHER_CATEGORY = '기타';

/** 레시피에 등장하는 티어들(오름차순). 데이터가 늘면 버튼도 따라 늘어난다. */
const TIERS = [...new Set(craftingData.recipes.map((recipe) => recipe.requiresTier))].sort(
  (a, b) => a - b,
);

/**
 * 왼쪽에서 오른쪽으로 차오르는 화살표.
 *
 * 마스크를 쓰지 않고 **채운 만큼만 다시 그린다.** 모달은 끌어서 옮길 수 있어서, 도형
 * 마스크를 쓰면 창을 옮길 때마다 마스크의 월드 좌표를 다시 맞춰야 한다. 화살표는
 * 사각형(자루) + 삼각형(촉) 두 조각뿐이라 잘라 그리는 편이 훨씬 단순하다.
 */
class ProgressArrow {
  private readonly track: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Graphics;

  constructor(
    builder: PanelBuilder,
    private readonly x: number,
    private readonly y: number,
  ) {
    this.track = builder.scene.add.graphics();
    this.fill = builder.scene.add.graphics();
    builder.add(this.track);
    builder.add(this.fill);

    this.paint(this.track, ARROW_LENGTH, ARROW_TRACK);
    this.set(0);
  }

  /** @param ratio 0~1. 0이면 아무것도 안 찬다. */
  set(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.fill.clear();
    if (clamped > 0) this.paint(this.fill, ARROW_LENGTH * clamped, ARROW_FILL);
  }

  /** 화살표를 왼쪽부터 `width`만큼만 그린다. */
  private paint(g: Phaser.GameObjects.Graphics, width: number, color: number): void {
    const shaftEnd = ARROW_LENGTH - ARROW_HEAD_LENGTH;
    g.fillStyle(color, 1);

    const shaftWidth = Math.min(width, shaftEnd);
    if (shaftWidth > 0) {
      g.fillRect(this.x, this.y - ARROW_SHAFT_HALF, shaftWidth, ARROW_SHAFT_HALF * 2);
    }
    if (width <= shaftEnd) return;

    // 촉은 끝으로 갈수록 좁아진다 — 잘린 지점의 반높이를 비례로 구해 사다리꼴로 채운다.
    const cut = width - shaftEnd;
    const halfAt = ARROW_HEAD_HALF * (1 - cut / ARROW_HEAD_LENGTH);
    g.fillPoints(
      [
        { x: this.x + shaftEnd, y: this.y - ARROW_HEAD_HALF },
        { x: this.x + shaftEnd + cut, y: this.y - halfAt },
        { x: this.x + shaftEnd + cut, y: this.y + halfAt },
        { x: this.x + shaftEnd, y: this.y + ARROW_HEAD_HALF },
      ],
      true,
    );
  }
}

/**
 * "제작" — 티어별 도구를 코어 창고의 재료로 만든다.
 *
 * **티어를 먼저 고르고 그 안에서 물건을 고른다.** 예전엔 전체 레시피를 한 격자에 쏟아
 * 놓고 칸마다 T1/T2/T3를 작은 글씨로 적었는데, 무엇이 지금 만들 수 있는 것인지 한눈에
 * 안 들어왔다. 티어가 목록을 가르는 축이면 "코어를 올리면 무엇이 열리는가"도 같이 보인다.
 *
 * 잠긴 티어도 **버튼은 보여준다** — 감추면 코어를 왜 올려야 하는지 알 수 없다. 만들 수
 * 있는지 여부는 서버가 최종 판정하고(World.craftItem), 여기서는 같은 규칙으로 미리
 * 보여주기만 한다.
 */
export class CraftPanel {
  onCraft: (recipeId: string) => void = () => {};

  private readonly recipes: CraftRecipe[] = craftingData.recipes;
  private readonly tierButtons: Phaser.GameObjects.Rectangle[] = [];
  private readonly tierLabels: Phaser.GameObjects.Text[] = [];
  /** 격자 칸은 티어를 바꿀 때 내용만 갈아 끼운다 — 티어마다 다시 만들면 선택이 풀린다. */
  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly slotIcons: SlotIcon[] = [];
  /** 카테고리 제목 줄. 칸과 같은 방식으로 미리 만들어 두고 보이고 숨긴다. */
  private readonly categoryLabels: Phaser.GameObjects.Text[] = [];
  /**
   * 목록이 담기는 통. 스크롤은 이 통을 위아래로 **움직여서** 만든다 —
   * 창을 끌어 옮길 수 있어서 마스크의 월드 좌표를 따로 맞춰야 하는데, 마스크 도형을
   * 같은 통에 넣어 두면 창과 함께 움직이므로 좌표를 다시 잡을 일이 없다.
   */
  private listView!: Phaser.GameObjects.Container;
  private scrollTrack!: Phaser.GameObjects.Rectangle;
  private scrollThumb!: Phaser.GameObjects.Rectangle;
  /** 목록 통의 보이는 높이와, 지금 얼마나 내렸는지. */
  private viewHeight = 0;
  private contentHeight = 0;
  private scrollY = 0;
  private readonly nameText: Phaser.GameObjects.Text;
  /** 비용 두 줄 — 글자 대신 게이지 아이콘 + 숫자. */
  private readonly costTag: CostTag;
  private readonly energyTag: CostTag;
  /** 제작 중에만 뜨는 남은 시간. 비용 줄과 같은 자리를 나눠 쓴다. */
  private readonly progressText: Phaser.GameObjects.Text;
  private readonly tierText: Phaser.GameObjects.Text;
  private readonly detailIcon: SlotIcon;
  /** 아래 띠 왼쪽의 그림 상자. 오른쪽 결과 상자와 같은 크기라 "→"가 한 줄로 읽힌다. */
  private readonly detailFrame: Phaser.GameObjects.Rectangle;

  /** 지금 보고 있는 티어와, 그 티어 안에서 고른 칸. */
  private tier = TIERS[0] ?? 1;
  private selected = 0;
  /** 마지막으로 받은 창고 내용물(아이템 id → 개수)과 코어 티어. */
  private coreTier = 0;
  private job = '';
  /** 코어 게이지 잔량. 모자란 쪽을 붉게 칠하는 데 쓴다. */
  private resource = 0;
  private energy = 0;
  /** 지금 만드는 중인 레시피와 남은 시간(초). 버튼 라벨이 진행 상황을 그대로 보여준다. */
  private craftingId = '';
  private craftRemaining = 0;
  /** 꺼내 가기를 기다리는 결과물(서버 값). */
  private output: InventorySlot | null = null;

  private readonly arrow: ProgressArrow;
  /** 결과 칸. SlotDrag가 여기서 인벤토리로 끌어갈 수 있게 손잡이로 내보낸다. */
  private readonly resultBox: Phaser.GameObjects.Rectangle;
  private readonly resultIcon: SlotIcon;
  private readonly resultCount: Phaser.GameObjects.Text;

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    const gridX = TIER_WIDTH + SECTION_GAP;
    const gridWidth = builder.width - gridX;


    // 아래 상세 띠를 **먼저** 잘라내고 나머지를 전부 위(고르는 곳)에 준다.
    // 반대로 하면(위를 내용 높이에 맞추고 남은 걸 상세에) 창이 세로로 길어질수록
    // 설명 칸만 커진다 — 이 창의 주인공은 격자다.
    const detailHeight = Phaser.Math.Clamp(
      Math.round(builder.height * DETAIL_RATIO),
      DETAIL_MIN_HEIGHT,
      DETAIL_MAX_HEIGHT,
    );
    // 위 구역의 최소 높이는 **격자와 티어 열 중 큰 쪽**이다. 격자만 보고 잡으면 티어가
    // 넷 이상일 때 마지막 버튼이 아래 구역에 가려진다(실제로 그랬다).
    const tierHeight =
      TIERS.length * TIER_BUTTON_HEIGHT + (TIERS.length - 1) * TIER_BUTTON_GAP;
    // 목록은 스크롤되므로 격자 높이에 창을 맞출 이유가 없다. 티어 열이 잘리지 않을
    // 만큼만 보장하고 나머지는 창이 주는 높이를 그대로 쓴다.
    const topHeight = Math.max(tierHeight, builder.height - detailHeight - SECTION_GAP);

    // --- 왼쪽: 티어 고르기. **구역 상자를 씌우지 않는다** — 버튼마다 이미 테두리가
    // 있는데 그걸 또 상자로 감싸면 테두리가 두 겹이 되고, 버튼 넷 아래로 남는 빈 상자
    // 바닥이 "여기 뭐가 더 있어야 하나" 싶게 만든다. 버튼만 세워 두면 그만이다.
    TIERS.forEach((tier, index) => {
      const y = index * (TIER_BUTTON_HEIGHT + TIER_BUTTON_GAP);
      const button = scene.add
        .rectangle(0, y, TIER_WIDTH, TIER_BUTTON_HEIGHT, TIER_IDLE_FILL, 1)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => this.selectTier(tier));
      builder.add(button);
      this.tierButtons.push(button);

      const label = scene.add
        .text(TIER_WIDTH / 2, y + TIER_BUTTON_HEIGHT / 2, `T${tier}`, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY * 2}px`,
          fontStyle: 'bold',
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);
      builder.add(label);
      this.tierLabels.push(label);
    });

    // --- 오른쪽: 그 티어의 물건들을 갈래별로 세운다.
    builder.addSection(gridX, 0, gridWidth, topHeight);

    this.viewHeight = topHeight - SECTION_PAD * 2;
    this.listViewTop = SECTION_PAD;
    this.listView = scene.add.container(gridX + SECTION_PAD, this.listViewTop);
    builder.add(this.listView);

    // 칸은 **모든 티어·모든 직업을 통틀어 가장 많은 경우**만큼 만들어 둔다.
    // 예전엔 만들 때의 직업(빈 문자열)으로 셈해서, 의무병 붕대처럼 직업 전용 레시피는
    // 칸이 아예 없어 목록에 뜨지 못했다.
    for (let index = 0; index < this.maxRows(); index += 1) {
      const box = builder.addSlot(0, 0, SLOT_SIZE, '', () => this.select(index));
      this.listView.add(box);
      this.slotBoxes.push(box);

      const icon = new SlotIcon(scene, SLOT_SIZE - 16);
      icon.place(0, 0, SLOT_SIZE - 16);
      if (icon.object) this.listView.add(icon.object);
      this.slotIcons.push(icon);
    }
    for (let index = 0; index < CATEGORIES.length + 1; index += 1) {
      const label = scene.add
        .text(0, 0, '', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
          color: ACCENT,
        })
        .setOrigin(0, 0);
      this.listView.add(label);
      this.categoryLabels.push(label);
    }

    // 스크롤 막대. 넘칠 때만 보인다 — 항상 그려 두면 짧은 목록에서도 "더 있나" 싶어진다.
    const scrollX = gridX + gridWidth - SECTION_PAD - SCROLL_WIDTH;
    this.scrollTrack = scene.add
      .rectangle(scrollX, SECTION_PAD, SCROLL_WIDTH, this.viewHeight, PANEL_STROKE, 0.25)
      .setOrigin(0, 0)
      .setVisible(false);
    this.scrollThumb = scene.add
      .rectangle(scrollX, SECTION_PAD, SCROLL_WIDTH, SCROLL_MIN, SELECTED_STROKE, 0.8)
      .setOrigin(0, 0)
      .setVisible(false);
    builder.add(this.scrollTrack);
    builder.add(this.scrollThumb);

    // 목록 위에서 휠을 굴리면 스크롤한다.
    //
    // 칸(setInteractive)에 휠 핸들러를 다는 대신 **씬 단위로 받고 좌표로 판정**한다 —
    // Phaser는 기본적으로 포인터 아래 **가장 위 객체 하나**에만 입력을 주므로, 뒤에
    // 깔아 둔 판에 핸들러를 달면 정작 칸 위에서 굴렸을 때 아무 일도 안 일어난다.
    //
    // 구역 판정용 사각형은 그리지도 만지지도 않는다 — 창을 끌어 옮겨도 월드 좌표가
    // 따라오는 자(尺) 역할만 한다.
    this.wheelArea = scene.add.rectangle(gridX, 0, gridWidth, topHeight).setOrigin(0, 0).setVisible(false);
    builder.add(this.wheelArea);
    scene.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
        if (!this.isListVisible()) return;
        if (!this.wheelArea.getBounds().contains(pointer.x, pointer.y)) return;
        this.scrollBy(dy > 0 ? SCROLL_STEP : -SCROLL_STEP);
      },
    );

    /*
     * --- 아래: 고른 것 하나를 설명하고 그 자리에서 만든다. 높이는 위에서 이미 정해졌다.
     *
     * 한 줄로 읽힌다: [만들 것] 설명 → (차오르는 화살표) → [결과]  ‖ [제작]
     * 제작 버튼만 상자 밖으로 빼서 띠 높이를 통째로 쓴다 — 누르는 자리가 설명과 섞이지
     * 않아야 한다(상점 탭의 구매/리롤과 같은 배치다).
     */
    const detailY = topHeight + SECTION_GAP;
    const detailWidth = builder.width - CRAFT_BUTTON_WIDTH - SECTION_GAP;
    builder.addSection(0, detailY, detailWidth, detailHeight);

    const rowMidY = detailY + detailHeight / 2;
    this.detailFrame = scene.add
      .rectangle(SECTION_PAD + BOX_SIZE / 2, rowMidY, BOX_SIZE, BOX_SIZE, PANEL_FILL, 0.9)
      .setStrokeStyle(1, PANEL_STROKE);
    builder.add(this.detailFrame);

    this.detailIcon = new SlotIcon(scene, BOX_SIZE - BOX_ICON_INSET);
    this.detailIcon.place(SECTION_PAD + BOX_SIZE / 2, rowMidY, BOX_SIZE - BOX_ICON_INSET);
    if (this.detailIcon.object) builder.add(this.detailIcon.object);

    // 네 줄: 이름(크게) · 만들 수 있는지 · 자원 · 에너지. 흐린 11px 한 덩어리였던 걸
    // 굵게 나눠 놓는다 — 모자란 게 자원인지 에너지인지가 줄 단위로 보여야 한다.
    const textX = SECTION_PAD * 2 + BOX_SIZE;
    const line = (offsetY: number, size: number, color: string) => {
      const text = scene.add.text(textX, detailY + SECTION_PAD + offsetY, '', {
        fontFamily: FONT,
        fontSize: `${size}px`,
        fontStyle: 'bold',
        color,
      });
      builder.add(text);
      return text;
    };
    this.nameText = line(0, SIZE_BODY * 2, BODY_TEXT).setText('-');
    this.tierText = line(DETAIL_LINE_TOP, SIZE_BODY, DIM_TEXT);
    // 비용 두 줄은 "자원"·"에너지"라는 글자 대신 **게이지와 같은 그림**을 앞에 세운다
    // (CostTag) — 코어 탭의 게이지, 화면 왼쪽 위 HUD와 같은 아이콘이라 어느 게이지에서
    // 나가는지가 글자 없이 읽힌다.
    this.costTag = new CostTag(builder, ICON_RESOURCE);
    this.energyTag = new CostTag(builder, ICON_ENERGY);
    const costY = detailY + SECTION_PAD + DETAIL_LINE_TOP + DETAIL_LINE_GAP + SIZE_BODY / 2;
    this.costTag.place(textX, costY);
    this.energyTag.place(textX, costY + DETAIL_LINE_GAP);
    // 제작 중에는 비용 대신 남은 시간이 그 자리를 쓴다. 시간에는 붙일 그림이 없어서
    // 글줄을 따로 두고 둘을 번갈아 보여준다.
    this.progressText = line(DETAIL_LINE_TOP + DETAIL_LINE_GAP, SIZE_BODY, ACCENT);

    const resultX = detailWidth - SECTION_PAD - BOX_SIZE;
    const arrowX = resultX - GAP - ARROW_LENGTH;

    this.arrow = new ProgressArrow(builder, arrowX, rowMidY);

    this.resultBox = scene.add
      .rectangle(resultX, rowMidY - BOX_SIZE / 2, BOX_SIZE, BOX_SIZE, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      // 여기서 끌어다 인벤토리로 꺼낸다 — SlotDrag는 pointerdown을 받으려면
      // 칸이 이미 interactive여야 한다.
      .setInteractive({ useHandCursor: true });
    builder.add(this.resultBox);

    this.resultIcon = new SlotIcon(scene, BOX_SIZE - BOX_ICON_INSET);
    this.resultIcon.place(resultX + BOX_SIZE / 2, rowMidY, BOX_SIZE - BOX_ICON_INSET);
    if (this.resultIcon.object) builder.add(this.resultIcon.object);

    this.resultCount = scene.add
      .text(resultX + BOX_SIZE - 4, rowMidY + BOX_SIZE / 2 - 3, '', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: BODY_TEXT,
      })
      .setOrigin(1, 1);
    builder.add(this.resultCount);

    builder.addHoloButton(
      builder.width - CRAFT_BUTTON_WIDTH,
      detailY,
      CRAFT_BUTTON_WIDTH,
      detailHeight,
      '제작',
      () => {
        const recipe = this.visibleRecipes()[this.selected];
        if (recipe) this.onCraft(recipe.id);
      },
      SIZE_BODY * 2,
    );

    this.selectTier(this.tier);
  }

  /**
   * 만들어 둘 칸 수 = **어느 티어·어느 직업이든 나올 수 있는 최대 개수**.
   *
   * 지금 직업으로 세면 안 된다 — 이 값은 창을 만들 때 한 번만 쓰는데, 그 시점의 직업은
   * 아직 빈 문자열이라 의무병 붕대 같은 직업 전용 레시피가 칸을 못 받았다(그래서
   * 목록에 영영 안 떴다). 칸 몇 개를 더 만들어 두는 비용이 그 버그보다 싸다.
   */
  private maxRows(): number {
    const counts = TIERS.map(
      (tier) => this.recipes.filter((recipe) => recipe.requiresTier === tier).length,
    );
    return Math.max(...counts);
  }

  private recipesOfTier(tier: number): CraftRecipe[] {
    /*
     * 직업 전용 레시피는 **아예 안 보여준다.**
     *
     * 잠금 표시(코어 티어처럼)로 두지 않은 이유는 성질이 달라서다 — 티어는 올리면
     * 열리는 목표지만, 직업은 이 게임 안에서 바꿀 수 없다. 영영 못 누르는 칸을
     * 띄워 두면 격자만 어지럽고 "왜 안 되지"만 남는다.
     */
    return this.recipes.filter(
      (recipe) =>
        recipe.requiresTier === tier && (!recipe.requiresJob || recipe.requiresJob === this.job),
    );
  }

  private visibleRecipes(): CraftRecipe[] {
    return this.recipesOfTier(this.tier);
  }

  /**
   * 코어 게이지·티어·제작 진행을 반영한다. HudScene이 스냅샷마다 호출한다 —
   * 충전이 차오르면 모달을 다시 열지 않아도 글자가 바로 바뀐다.
   */
  setContext(context: {
    coreTier: number;
    /** 보는 사람의 직업. 직업 전용 레시피(의무병 붕대)를 목록에서 걸러낸다. */
    job: string;
    resource: number;
    energy: number;
    craftingId: string;
    craftRemaining: number;
    output: InventorySlot | null;
  }): void {
    this.coreTier = context.coreTier;
    this.job = context.job;
    this.resource = context.resource;
    this.energy = context.energy;
    this.craftingId = context.craftingId;
    this.craftRemaining = context.craftRemaining;
    this.output = context.output;
    this.refreshProgress();
    this.refreshTiers();
    this.refreshDetail();
  }

  /**
   * 화살표를 채우고, 다 차면 결과 상자에 만들어진 물건을 띄운다.
   *
   * 완성 판정은 **제작 중이던 레시피가 사라진 순간**이다 — 서버가 "완성했다"는 신호를
   * 따로 보내지 않지만, 비용을 미리 받는 구조라 진행 중에는 반드시 값이 들어 있다.
   * 결과는 다음 제작을 걸 때까지 남겨 둔다(바로 지우면 눈 깜빡할 사이에 사라진다).
   */
  /**
   * 화살표를 채우고 결과 칸을 그린다.
   *
   * 결과는 **서버가 들고 있는 값**(craftOutput)을 그대로 비춘다 — 예전엔 "제작 중이던
   * 레시피가 사라진 순간"으로 클라가 추측했는데, 이제 결과가 꺼내 갈 때까지 남아 있어서
   * 추측할 이유가 없다. 남이 꺼내 가도(같은 칸을 쓰지 않지만) 화면이 바로 따라온다.
   */
  private refreshProgress(): void {
    if (this.craftingId) {
      const total = craftingData.craftSeconds;
      this.arrow.set(total > 0 ? 1 - this.craftRemaining / total : 0);
    } else {
      // 꺼내 갈 물건이 남아 있으면 화살표를 가득 채운 채로 둔다.
      this.arrow.set(this.output ? 1 : 0);
    }

    this.resultIcon.setItem(this.output?.itemId ?? null);
    this.resultCount.setText(this.output && this.output.count > 1 ? `${this.output.count}` : '');
    this.resultBox.setStrokeStyle(1, this.output ? SELECTED_STROKE : PANEL_STROKE);
  }

  /** 결과 칸 손잡이. SlotDrag가 드래그 시작점으로 등록한다. */
  get craftOutputCell(): Phaser.GameObjects.Rectangle {
    return this.resultBox;
  }

  private selectTier(tier: number): void {
    this.tier = tier;
    this.selected = 0;
    // 티어를 바꾸면 목록이 통째로 갈리므로 스크롤도 맨 위로 되돌린다.
    this.scrollY = 0;
    this.refreshTiers();
    this.refreshGrid();
    this.refreshDetail();
  }

  /**
   * 티어 버튼 모양. 상단 탭과 같은 규칙이다 — 고른 것은 밝은 판 + 초록 테두리 + 초록
   * 글자, 나머지는 어두운 판. 잠긴 티어는 흐리게 눌러 두되 **지우지는 않는다**
   * ("코어를 올리면 열린다"를 계속 보여줘야 한다).
   */
  private refreshTiers(): void {
    TIERS.forEach((tier, index) => {
      const locked = tier > this.coreTier;
      const active = tier === this.tier;
      const button = this.tierButtons[index]!;
      button.setFillStyle(active ? TIER_ACTIVE_FILL : TIER_IDLE_FILL, 1);
      button.setStrokeStyle(active ? 2 : 1, active ? SELECTED_STROKE : PANEL_STROKE);
      button.setAlpha(locked ? 0.5 : 1);
      this.tierLabels[index]!.setColor(active ? ACCENT : locked ? LACKING_TEXT : DIM_TEXT);
    });
  }

  /**
   * 지금 티어의 레시피를 **갈래별로** 세운다. 갈래 제목 아래에 그 갈래의 칸들이 오고,
   * 빈 갈래는 제목째 건너뛴다 — 없는 칸에 제목만 남으면 "여기 뭔가 있어야 하나" 싶어진다.
   *
   * 배치가 끝나면 전체 높이를 재서 스크롤이 필요한지 판단한다.
   */
  private refreshGrid(): void {
    const recipes = this.visibleRecipes();
    const groups = this.groupRecipes(recipes);

    let y = 0;
    let slot = 0;
    let labelAt = 0;

    for (const group of groups) {
      const label = this.categoryLabels[labelAt]!;
      labelAt += 1;
      label.setText(group.title).setPosition(0, y).setVisible(true);
      y += CATEGORY_HEAD;

      group.recipes.forEach((recipe, indexInGroup) => {
        const col = indexInGroup % SLOT_COLS;
        const row = Math.floor(indexInGroup / SLOT_COLS);
        const box = this.slotBoxes[slot]!;
        const x = col * (SLOT_SIZE + SLOT_GAP);
        const top = y + row * (SLOT_SIZE + SLOT_GAP);

        box.setPosition(x, top).setVisible(true);
        box.setStrokeStyle(1, recipe.index === this.selected ? SELECTED_STROKE : PANEL_STROKE);
        this.slotIcons[slot]!.setItem(recipe.recipe.itemId);
        this.slotIcons[slot]!.place(x + SLOT_SIZE / 2, top + SLOT_SIZE / 2, SLOT_SIZE - 16);
        // 칸을 누르면 **원래 목록에서의 번호**를 고른다 — 갈래로 나누면서 화면 순서와
        // 목록 순서가 달라지므로, 눌린 칸이 어느 레시피인지 여기서 묶어 둔다.
        this.slotOfBox[slot] = recipe.index;
        slot += 1;
      });

      const rows = Math.ceil(group.recipes.length / SLOT_COLS);
      y += rows * SLOT_SIZE + (rows - 1) * SLOT_GAP + CATEGORY_GAP;
    }

    // 남은 칸·제목은 숨긴다.
    for (let index = slot; index < this.slotBoxes.length; index += 1) {
      this.slotBoxes[index]!.setVisible(false);
      this.slotIcons[index]!.setItem(null);
    }
    for (let index = labelAt; index < this.categoryLabels.length; index += 1) {
      this.categoryLabels[index]!.setVisible(false);
    }

    this.usedSlots = slot;
    this.usedLabels = labelAt;
    this.contentHeight = Math.max(0, y - CATEGORY_GAP);
    this.applyScroll();
  }

  /** 화면 칸 번호 → 레시피 목록 번호. 갈래로 나누면서 순서가 달라져서 필요하다. */
  private readonly slotOfBox: number[] = [];
  /** 지금 쓰이는 칸 수와 갈래 제목 수. 컬링이 "원래 보여야 할 것"을 알아야 한다. */
  private usedSlots = 0;
  private usedLabels = 0;

  /**
   * 보이는 창(viewHeight) 밖으로 나간 칸·제목을 숨긴다.
   *
   * 마스크로 자르는 대신 통째로 숨기는 이유는 SCROLL_STEP 주석에 적어 뒀다.
   * **완전히 들어오는 것만** 남긴다 — 반쯤 걸친 칸을 남기면 아래 상세 띠를 침범한다.
   */
  private cullList(): void {
    const top = this.scrollY;
    const bottom = this.scrollY + this.viewHeight;

    for (let index = 0; index < this.usedSlots; index += 1) {
      const box = this.slotBoxes[index]!;
      const inside = box.y >= top - 0.5 && box.y + SLOT_SIZE <= bottom + 0.5;
      box.setVisible(inside);
      // SlotIcon은 아틀라스가 없으면 그림 자체가 없다 — 있을 때만 숨긴다.
      this.slotIcons[index]!.object?.setVisible(inside);
    }
    for (let index = 0; index < this.usedLabels; index += 1) {
      const label = this.categoryLabels[index]!;
      label.setVisible(label.y >= top - 0.5 && label.y + CATEGORY_HEAD <= bottom + 0.5);
    }
  }

  /** 레시피를 갈래별로 묶는다. 원래 목록에서의 번호를 함께 들고 간다. */
  private groupRecipes(
    recipes: CraftRecipe[],
  ): { title: string; recipes: { recipe: CraftRecipe; index: number }[] }[] {
    const groups = [...CATEGORIES.map((c) => ({ title: c.title, kinds: c.kinds })), {
      title: OTHER_CATEGORY,
      kinds: [] as readonly string[],
    }].map((c) => ({ title: c.title, kinds: c.kinds, recipes: [] as { recipe: CraftRecipe; index: number }[] }));

    recipes.forEach((recipe, index) => {
      const kind = itemsData[recipe.itemId]?.kind ?? '';
      const group =
        groups.find((candidate) => candidate.kinds.includes(kind)) ?? groups[groups.length - 1]!;
      group.recipes.push({ recipe, index });
    });

    return groups.filter((group) => group.recipes.length > 0);
  }

  /** 휠 한 칸. 끝을 넘어가지 않게 가둔다. */
  private scrollBy(delta: number): void {
    const max = Math.max(0, this.contentHeight - this.viewHeight);
    this.scrollY = Phaser.Math.Clamp(this.scrollY + delta, 0, max);
    this.applyScroll();
  }

  /** 통을 내린 만큼 올리고, 보이는 창 밖으로 나간 줄을 숨기고, 막대를 비율에 맞춘다. */
  private applyScroll(): void {
    const max = Math.max(0, this.contentHeight - this.viewHeight);
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, max);
    this.listView.setY(this.listViewTop - this.scrollY);
    this.cullList();

    const overflow = max > 0;
    this.scrollTrack.setVisible(overflow);
    this.scrollThumb.setVisible(overflow);
    if (!overflow) return;

    const ratio = this.viewHeight / this.contentHeight;
    const thumbHeight = Math.max(SCROLL_MIN, this.viewHeight * ratio);
    const travel = this.viewHeight - thumbHeight;
    this.scrollThumb.setSize(SCROLL_WIDTH, thumbHeight);
    this.scrollThumb.setY(this.scrollTrack.y + (max > 0 ? (this.scrollY / max) * travel : 0));
  }

  /** 목록 통의 원래 y(스크롤 0일 때). 생성 시 정하고 바뀌지 않는다. */
  private listViewTop = 0;
  /** 휠을 받을 구역(그리지 않는 자). 창을 끌어 옮기면 월드 좌표가 따라온다. */
  private wheelArea!: Phaser.GameObjects.Rectangle;

  /**
   * 이 목록이 지금 화면에 있는가. 제작 탭이 아니거나 창이 닫혀 있으면 휠을 무시해야
   * 한다 — 씬 단위로 받기 때문에 안 보이는 동안에도 이벤트가 들어온다.
   */
  private isListVisible(): boolean {
    let node: Phaser.GameObjects.GameObject | null = this.listView;
    while (node) {
      const display = node as unknown as { visible: boolean; parentContainer: Phaser.GameObjects.Container | null };
      if (!display.visible) return false;
      node = display.parentContainer;
    }
    return true;
  }

  private select(boxIndex: number): void {
    const index = this.slotOfBox[boxIndex];
    if (index === undefined || index >= this.visibleRecipes().length) return;
    this.selected = index;
    this.refreshGrid();
    this.refreshDetail();
  }

  private refreshDetail(): void {
    const recipe = this.visibleRecipes()[this.selected];
    if (!recipe) {
      this.nameText.setText('-');
      this.tierText.setText('');
      this.progressText.setText('');
      this.costTag.setVisible(false);
      this.energyTag.setVisible(false);
      this.detailIcon.setItem(null);
      return;
    }

    const produced = recipe.count && recipe.count > 1 ? ` ×${recipe.count}` : '';
    this.nameText.setText((itemsData[recipe.itemId]?.name ?? recipe.itemId) + produced);
    // 그림은 **레시피가 바뀌면 항상** 갈아 끼운다. 예전엔 이 줄이 함수 맨 끝에 있어서,
    // 제작 중일 때 일찍 return하면 그림만 이전 것으로 남았다.
    this.detailIcon.setItem(recipe.itemId);

    const locked = recipe.requiresTier > this.coreTier;
    this.tierText
      .setText(locked ? `코어 티어 ${recipe.requiresTier} 필요` : '제작 가능')
      .setColor(locked ? LACKING_TEXT : ACCENT);

    /*
     * 비용은 코어 게이지에서 나간다 — 가진 만큼/필요한 만큼을 **줄을 나눠** 적어,
     * 모자란 쪽이 어느 게이지인지 붉은 줄 하나로 보이게 한다. 제작 중이면 남은 시간이
     * 자원 줄을 대신한다(글줄 폭이 좁아 긴 문장은 넘친다 — 짧게 끊는다).
     */
    if (this.craftingId) {
      this.progressText.setText(`만드는 중 ${this.craftRemaining.toFixed(1)}초`);
      this.costTag.setVisible(false);
      this.energyTag.setVisible(false);
      return;
    }

    this.progressText.setText('');
    const energyNeed = recipe.cost.energy ?? 0;
    this.costTag.setVisible(true);
    this.costTag.setValue(
      `${this.resource} / ${recipe.cost.resource}`,
      this.resource < recipe.cost.resource ? LACKING_TEXT : BODY_TEXT,
    );
    this.energyTag.setVisible(energyNeed > 0);
    this.energyTag.setValue(
      `${this.energy} / ${energyNeed}`,
      this.energy < energyNeed ? LACKING_TEXT : BODY_TEXT,
    );
  }
}
