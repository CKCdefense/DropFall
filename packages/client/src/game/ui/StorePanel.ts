import Phaser from 'phaser';
import { itemsData, shopData, type ItemRarity } from '@dropfall/shared';
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
import { ICON_ENERGY } from './hudBar';

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const SELECTED_STROKE = 0x6fd08c;
const LACKING_TEXT = '#d98a8a';

/**
 * 등급 색. 테두리(숫자)와 글자(문자열) 양쪽에 쓰므로 짝으로 둔다 — 등급은 가격보다
 * 먼저 눈에 들어와야 하는 정보라 색으로 먼저 말한다.
 */
const RARITY: Record<ItemRarity, { label: string; text: string; stroke: number }> = {
  common: { label: '일반', text: '#b9c0cc', stroke: 0x8a91a0 },
  rare: { label: '희귀', text: '#6fa8dc', stroke: 0x4f88bc },
  epic: { label: '에픽', text: '#b07ad6', stroke: 0x8f5ab6 },
  legendary: { label: '전설', text: '#e8b44c', stroke: 0xc8942c },
};

/**
 * 진열 칸.
 *
 * 상점은 하루에 여섯 개만 파는 창이라 칸을 아낄 이유가 없다 — 물건 그림이 커야 무엇을
 * 파는지 아이콘만 보고 안다. 위쪽을 차지하던 상점 주인 그림을 걷어내고 그 높이를
 * 통째로 칸에 넘겼다.
 */
const SLOT_SIZE = 140;
const SLOT_GAP = 18;
const SLOT_COLS = 3;
/**
 * 그림 여백. 가격표가 글자(11px)에서 그림표(24px 전지 + 22px 숫자)로 커지면서 아래
 * 띠가 두꺼워졌다 — 그림을 그만큼 줄이고 위로 올려야 둘이 겹치지 않는다.
 */
const ICON_INSET = 44;
/** 그림 중심을 칸 가운데보다 이만큼 올린다. 아래에 가격표가 앉을 자리를 비운다. */
const ICON_RISE = 14;

/**
 * 머리글(오늘의 진열 · 에너지) 글자 크기.
 *
 * 7px 흐린 회색이라 무엇을 보는 창인지도, 에너지가 얼마인지도 눈에 안 들어왔다.
 * 굵은 자체(Galmuri11-Bold)가 있는 11px의 정수배로 올린다 — 픽셀 폰트는 정수배에서만
 * 선명하고, Galmuri7에는 굵은 자체가 없어 bold를 걸면 가짜 굵기로 번진다.
 */
const HEAD_FONT_SIZE = SIZE_BODY * 2;
/** 구역 상자 안쪽 여백과 상자 사이 간격. 세 구역이 같은 값을 써야 줄이 맞는다. */
const SECTION_PAD = 12;
const SECTION_GAP = 10;

/**
 * 아래 띠 오른쪽의 **버튼 칸** — 구매와 리롤이 위아래로 선다.
 *
 * 두 버튼은 성격이 다르다(고른 물건을 산다 / 진열 전체를 다시 뽑는다). 설명 글 옆에
 * 섞어 두면 어느 쪽이 무엇에 붙은 버튼인지 흐려져서, 상자를 따로 세워 "여기는 누르는
 * 자리"로 갈라 놓는다.
 */
const ACTION_WIDTH = 152;
const ACTION_GAP = 8;
/** 버튼 글자. 40px 높이의 판에 11px 글자를 넣으면 눌러야 할 것으로 안 보인다. */
const ACTION_FONT_SIZE = SIZE_BODY * 2;

/** 상세 그림과 등급 테두리 사이 여백. 테두리가 그림에 닿으면 액자가 아니라 잘린 것처럼 보인다. */
const DETAIL_ICON_INSET = 14;
/** 이름(22px) 아래로 세 줄이 이어진다. 줄 간격은 글자 높이 + 숨통. */
const DETAIL_LINE_TOP = 26;
const DETAIL_LINE_GAP = 18;

/**
 * 값의 단위는 글자가 아니라 **그림**이다(CostTag). 에너지가 곧 돈이라 숫자만 있으면
 * 무엇의 230인지 모르는데, "E"나 "에너지"라고 적는 대신 코어 게이지와 같은 전지
 * 그림을 앞에 세운다 — 어느 게이지에서 나가는지가 글자 없이 읽힌다.
 */
const PRICE_BOTTOM = 18;
/** 하루 진열 칸 수. 데이터가 정하는 값이라 UI도 거기서 읽는다. */
const STOCK_SIZE = shopData.weaponsPerDay + shopData.consumablesPerDay;

/**
 * "상점" — 판 돈으로 오늘의 물건을 산다.
 *
 * 진열은 **매일 바뀐다**(World.rollShopStock). 그래서 칸을 고정 목록으로 만들지 않고
 * 최대 개수만큼 만들어 두고 내용만 갈아 끼운다 — 낮이 바뀔 때 UI를 다시 만들면 그
 * 순간 열려 있던 모달이 깜빡이고 선택도 풀린다.
 *
 * 실제 소비/지급은 서버가 한다(World.buyFromShop / sellToShop). 여기서는 같은 규칙으로
 * 살 수 있는지만 미리 색으로 알려준다.
 */
export class StorePanel {
  onPurchase: (itemId: string) => void = () => {};
  /** 리롤 버튼. 비용은 서버가 판정하고 화면은 같은 값을 비추기만 한다. */
  onReroll: () => void = () => {};

  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly slotIcons: SlotIcon[] = [];
  private readonly slotPrices: CostTag[] = [];
  /** 가격표를 놓을 자리(칸 아래 가운데). 폭이 값에 따라 바뀌어서 매번 다시 놓는다. */
  private readonly slotPriceAt: { x: number; y: number }[] = [];
  private readonly energyTag: CostTag;
  private readonly energyAt: { x: number; y: number };
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly rarityText: Phaser.GameObjects.Text;
  private readonly priceTag: CostTag;
  private readonly priceAt: { x: number; y: number };
  private readonly flavorText: Phaser.GameObjects.Text;
  private readonly detailIcon: SlotIcon;
  /** 상세 그림을 감싸는 등급 테두리. */
  private readonly detailFrame: Phaser.GameObjects.Rectangle;
  private readonly rerollButton: Phaser.GameObjects.Rectangle;
  private readonly rerollLabel: Phaser.GameObjects.Text;

  private stock: string[] = [];
  private selected = 0;
  private energy = 0;
  private rerollCost = 0;

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    // 판매가 없어지면서 오른쪽 열이 통째로 비었다 — 진열 격자가 폭 전체를 쓴다.
    const leftWidth = builder.width;

    // 제작 탭과 같은 규칙: 아래 상세 띠를 먼저 잘라내고 남은 높이를 진열 격자에 준다
    // (theme.DETAIL_RATIO). 두 탭의 아래 띠가 같은 자리에 있어야 탭을 오갈 때 안 흔들린다.
    const detailHeight = Phaser.Math.Clamp(
      Math.round(builder.height * DETAIL_RATIO),
      DETAIL_MIN_HEIGHT,
      DETAIL_MAX_HEIGHT,
    );
    const gridRows = Math.ceil(STOCK_SIZE / SLOT_COLS);
    const headHeight = HEAD_FONT_SIZE + 8;
    const gridBlock = gridRows * SLOT_SIZE + (gridRows - 1) * SLOT_GAP;
    const gridHeight = Math.max(
      SECTION_PAD * 2 + headHeight + gridBlock,
      builder.height - detailHeight - SECTION_GAP,
    );

    builder.addSection(0, 0, leftWidth, gridHeight);
    this.dayText = scene.add.text(SECTION_PAD, SECTION_PAD, '오늘의 진열', {
      fontFamily: FONT,
      fontSize: `${HEAD_FONT_SIZE}px`,
      fontStyle: 'bold',
      color: BODY_TEXT,
    });
    builder.add(this.dayText);
    // 보유 에너지도 가격과 같은 그림표다 — 같은 값이니 같은 그림이어야 한다.
    this.energyTag = new CostTag(builder, ICON_ENERGY, {
      iconScale: 2,
      fontSize: HEAD_FONT_SIZE,
    });
    this.energyAt = { x: leftWidth - SECTION_PAD, y: SECTION_PAD + HEAD_FONT_SIZE / 2 };

    // 격자는 상자 안에서 **가로세로 모두** 가운데로 놓는다. 주인 그림이 빠지면서 남은
    // 높이가 아래쪽에 빈 띠로 몰리는데, 물건이 창 한가운데 있어야 진열대로 읽힌다.
    const gridWidth = SLOT_COLS * SLOT_SIZE + (SLOT_COLS - 1) * SLOT_GAP;
    const gridX = Math.round((leftWidth - gridWidth) / 2);
    const gridTop = SECTION_PAD + headHeight;
    const gridSlack = gridHeight - SECTION_PAD - gridTop - gridBlock;
    const gridY = gridTop + Math.max(0, Math.round(gridSlack / 2));

    for (let index = 0; index < STOCK_SIZE; index += 1) {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = gridX + col * (SLOT_SIZE + SLOT_GAP);
      const y = gridY + row * (SLOT_SIZE + SLOT_GAP);

      this.slotBoxes.push(builder.addSlot(x, y, SLOT_SIZE, '', () => this.select(index)));
      // addSlot이 만든 라벨은 직접 잡을 수 없어서 가격을 따로 얹는다.
      // "E" 같은 글자 단위 대신 **에너지 게이지와 같은 그림**을 앞에 세운다(CostTag).
      const price = new CostTag(builder, ICON_ENERGY, { iconScale: 2, fontSize: SIZE_BODY * 2 });
      this.slotPrices.push(price);
      this.slotPriceAt.push({ x: x + SLOT_SIZE / 2, y: y + SLOT_SIZE - PRICE_BOTTOM });

      const icon = new SlotIcon(scene, SLOT_SIZE - ICON_INSET);
      icon.place(x + SLOT_SIZE / 2, y + SLOT_SIZE / 2 - ICON_RISE, SLOT_SIZE - ICON_INSET);
      if (icon.object) builder.add(icon.object);
      this.slotIcons.push(icon);
    }

    // --- 상세: 고른 물건 하나를 설명한다. 오른쪽에 버튼 칸을 따로 세우므로 설명 상자는
    // 그만큼 좁다. 높이는 위에서 정해졌다.
    const detailY = gridHeight + SECTION_GAP;
    const detailWidth = leftWidth - ACTION_WIDTH - SECTION_GAP;
    builder.addSection(0, detailY, detailWidth, detailHeight);

    const iconSize = detailHeight - SECTION_PAD * 2;
    const iconCx = SECTION_PAD + iconSize / 2;
    const iconCy = detailY + SECTION_PAD + iconSize / 2;
    // 그림 뒤에 등급 테두리를 깐다 — 위 격자는 칸 테두리로 등급을 말하는데 여기만
    // 아무 표시가 없으면 고른 순간 그 정보가 사라진다.
    this.detailFrame = scene.add
      .rectangle(iconCx, iconCy, iconSize, iconSize, PANEL_FILL, 0.9)
      .setStrokeStyle(2, PANEL_STROKE);
    builder.add(this.detailFrame);

    this.detailIcon = new SlotIcon(scene, iconSize - DETAIL_ICON_INSET);
    this.detailIcon.place(iconCx, iconCy, iconSize - DETAIL_ICON_INSET);
    if (this.detailIcon.object) builder.add(this.detailIcon.object);

    // 네 줄: 이름(크게) · 등급 · 가격 · 곁들임 글. 굵은 자체가 있는 11px의 정수배만 쓴다.
    const textX = SECTION_PAD * 2 + iconSize;
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
    this.rarityText = line(DETAIL_LINE_TOP, SIZE_BODY, DIM_TEXT);
    this.flavorText = line(DETAIL_LINE_TOP + DETAIL_LINE_GAP * 2, SIZE_BODY, DIM_TEXT);
    // 가격도 진열칸과 같은 그림표를 쓴다 — 같은 값을 두 곳에서 다르게 부르면 안 된다.
    this.priceTag = new CostTag(builder, ICON_ENERGY);
    this.priceAt = {
      x: textX,
      y: detailY + SECTION_PAD + DETAIL_LINE_TOP + DETAIL_LINE_GAP + SIZE_BODY / 2,
    };

    // --- 버튼: 구매(위) · 리롤(아래). 구역 상자를 씌우지 않는다 — 홀로그램 판 자체가
    // 이미 테두리라 상자를 두르면 테두리가 겹쳐 보인다. 두 버튼이 아래 띠의 높이를
    // 정확히 나눠 가져서 설명 상자와 위아래가 딱 맞는다(아래쪽이 1px 더 큰 건 홀수
    // 높이를 남김없이 쓰기 때문이다).
    const actionX = leftWidth - ACTION_WIDTH;
    const topHeight = Math.floor((detailHeight - ACTION_GAP) / 2);
    const bottomHeight = detailHeight - ACTION_GAP - topHeight;

    builder.addHoloButton(
      actionX,
      detailY,
      ACTION_WIDTH,
      topHeight,
      '구매',
      () => {
        const itemId = this.stock[this.selected];
        if (itemId) this.onPurchase(itemId);
      },
      ACTION_FONT_SIZE,
    );

    const reroll = builder.addHoloButton(
      actionX,
      detailY + topHeight + ACTION_GAP,
      ACTION_WIDTH,
      bottomHeight,
      '리롤',
      () => this.onReroll(),
      ACTION_FONT_SIZE,
    );
    this.rerollButton = reroll.box;
    this.rerollLabel = reroll.label;

    this.select(0);
  }

  /** 진열·에너지·리롤 비용을 반영한다. HudScene이 스냅샷마다 호출한다. */
  setContext(stock: string[], energy: number, rerollCost: number): void {
    this.energy = energy;
    this.rerollCost = rerollCost;
    this.energyTag.setValue(`${energy}`, ACCENT);
    // 오른쪽 끝에 맞춰 놓는다 — 자릿수가 늘면 그림이 왼쪽으로 밀려야 한다.
    this.energyTag.place(this.energyAt.x, this.energyAt.y, 1);

    // 비용은 돌릴수록 오른다 — 버튼에 지금 값을 적어 두면 "얼마 나갈지"를 누르기 전에 안다.
    const affordable = energy >= rerollCost;
    this.rerollLabel.setText(`리롤 ${rerollCost}`).setColor(affordable ? ACCENT : LACKING_TEXT);
    this.rerollButton.setAlpha(affordable ? 1 : 0.55);

    if (!sameStock(this.stock, stock)) {
      this.stock = [...stock];
      this.refreshSlots();
      // 어제 고른 칸이 오늘은 다른 물건이다 — 선택을 첫 칸으로 되돌린다.
      this.select(0);
    }
    this.refreshDetail();
  }

  private refreshSlots(): void {
    for (let index = 0; index < STOCK_SIZE; index += 1) {
      const itemId = this.stock[index];
      const item = itemId === undefined ? undefined : itemsData[itemId];

      this.slotIcons[index].setItem(itemId ?? null);
      const tag = this.slotPrices[index]!;
      const at = this.slotPriceAt[index]!;
      tag.setVisible(item?.buyPrice !== undefined);
      if (item?.buyPrice !== undefined) {
        tag.setValue(`${item.buyPrice}`);
        // 폭이 자릿수에 따라 달라지므로 값을 넣은 **뒤에** 가운데로 다시 놓는다.
        tag.place(at.x, at.y, 0.5);
      }
      this.slotBoxes[index].setAlpha(item ? 1 : 0.35);
    }
  }

  private select(index: number): void {
    this.selected = index;
    this.slotBoxes.forEach((box, i) => {
      if (i === index) {
        box.setStrokeStyle(2, SELECTED_STROKE);
        return;
      }
      // 선택되지 않은 칸은 **등급 색**으로 테두리를 준다 — 아이콘만으로는 전설인지
      // 일반인지 알 수 없고, 하루치 진열의 값어치가 한눈에 들어와야 한다.
      const rarity = rarityOf(this.stock[i]);
      box.setStrokeStyle(1, rarity ? RARITY[rarity].stroke : PANEL_STROKE);
    });
    this.refreshDetail();
  }

  private refreshDetail(): void {
    const itemId = this.stock[this.selected];
    const item = itemId === undefined ? undefined : itemsData[itemId];
    if (!item) {
      this.nameText.setText('-');
      this.rarityText.setText('');
      this.priceTag.setVisible(false);
      this.flavorText.setText('');
      this.detailFrame.setStrokeStyle(2, PANEL_STROKE);
      this.detailIcon.setItem(null);
      return;
    }

    this.nameText.setText(item.name);

    const rarity = rarityOf(itemId);
    this.rarityText
      .setText(rarity ? RARITY[rarity].label : '')
      .setColor(rarity ? RARITY[rarity].text : DIM_TEXT);
    this.detailFrame.setStrokeStyle(2, rarity ? RARITY[rarity].stroke : PANEL_STROKE);

    const price = item.buyPrice ?? 0;
    this.priceTag.setVisible(true);
    this.priceTag.setValue(`${price}`, this.energy >= price ? BODY_TEXT : LACKING_TEXT);
    this.priceTag.place(this.priceAt.x, this.priceAt.y);

    // 효과 수치("체력 +40")를 적던 자리다. 살지 말지가 계산으로 끝나지 않도록
    // 곁들임 글로 바꿨다 — 무엇에 쓰는 물건인지는 아이콘과 이름이 이미 말한다.
    this.flavorText.setText(item.flavor ?? '');

    this.detailIcon.setItem(itemId ?? null);
  }
}

function rarityOf(itemId: string | undefined): ItemRarity | undefined {
  return itemId === undefined ? undefined : itemsData[itemId]?.rarity;
}

function sameStock(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((itemId, index) => itemId === b[index]);
}
