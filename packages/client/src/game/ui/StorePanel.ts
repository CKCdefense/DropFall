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
  FONT_SMALL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
} from './theme';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';

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

const SLOT_SIZE = 62;
const SLOT_GAP = 10;
const SLOT_COLS = 3;
const ICON_INSET = 16;
/** 구역 상자 안쪽 여백과 상자 사이 간격. 세 구역이 같은 값을 써야 줄이 맞는다. */
const SECTION_PAD = 12;
const SECTION_GAP = 10;
const BUY_WIDTH = 84;
const BUY_HEIGHT = 32;
const SELL_ROW_HEIGHT = 26;
const SELL_BUTTON_WIDTH = 78;
/** 왼쪽(진열+상세)이 가져가는 폭 비율. 나머지가 판매 구역이다. */
const LEFT_RATIO = 0.62;

/** 하루 진열 칸 수. 데이터가 정하는 값이라 UI도 거기서 읽는다. */
const STOCK_SIZE = shopData.weaponsPerDay + shopData.consumablesPerDay;

/** 창고에 있으면 팔 수 있는 것들. 진열 순서는 값이 비싼 순이다. */
const SELLABLE = ['drop_rare', 'drop_normal'];

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
  onSell: (itemId: string, count: number) => void = () => {};

  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly slotIcons: SlotIcon[] = [];
  private readonly slotPrices: Phaser.GameObjects.Text[] = [];
  private readonly moneyText: Phaser.GameObjects.Text;
  private readonly dayText: Phaser.GameObjects.Text;
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly rarityText: Phaser.GameObjects.Text;
  private readonly priceText: Phaser.GameObjects.Text;
  private readonly detailIcon: SlotIcon;
  private readonly sellLabels = new Map<string, Phaser.GameObjects.Text>();

  private stock: string[] = [];
  private selected = 0;
  private money = 0;
  private storage: Record<string, number> = {};

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    // 와이어프레임 구조: 왼쪽에 [진열 격자] 위, [상세] 아래. 오른쪽에 [판매].
    // 창이 넓어져서 판매를 아래로 더 쌓는 대신 옆 칸으로 뺐다 — 아래로만 쌓으면
    // 상자 셋이 세로로 길게 늘어져 넓어진 가로가 그대로 빈다.
    const leftWidth = Math.floor((builder.width - SECTION_GAP) * LEFT_RATIO);
    const rightX = leftWidth + SECTION_GAP;
    const rightWidth = builder.width - rightX;

    // 제작 탭과 같은 규칙: 아래 상세 띠를 먼저 잘라내고 남은 높이를 진열 격자에 준다
    // (theme.DETAIL_RATIO). 두 탭의 아래 띠가 같은 자리에 있어야 탭을 오갈 때 안 흔들린다.
    const detailHeight = Phaser.Math.Clamp(
      Math.round(builder.height * DETAIL_RATIO),
      DETAIL_MIN_HEIGHT,
      DETAIL_MAX_HEIGHT,
    );
    const gridRows = Math.ceil(STOCK_SIZE / SLOT_COLS);
    const gridHeight = Math.max(
      SECTION_PAD * 2 + 16 + gridRows * SLOT_SIZE + (gridRows - 1) * SLOT_GAP,
      builder.height - detailHeight - SECTION_GAP,
    );

    builder.addSection(0, 0, leftWidth, gridHeight);
    this.dayText = scene.add.text(SECTION_PAD, SECTION_PAD, '오늘의 진열', {
      fontFamily: FONT_SMALL,
      fontSize: `${SIZE_SMALL}px`,
      color: DIM_TEXT,
    });
    this.moneyText = scene.add
      .text(leftWidth - SECTION_PAD, SECTION_PAD - 2, '0 G', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: ACCENT,
      })
      .setOrigin(1, 0);
    builder.add(this.dayText);
    builder.add(this.moneyText);

    // 격자는 상자 안에서 가운데 정렬한다 — 왼쪽에 몰리면 남은 폭이 빈 자리로 보인다.
    const gridWidth = SLOT_COLS * SLOT_SIZE + (SLOT_COLS - 1) * SLOT_GAP;
    const gridX = Math.round((leftWidth - gridWidth) / 2);
    const gridY = SECTION_PAD + 16;

    for (let index = 0; index < STOCK_SIZE; index += 1) {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = gridX + col * (SLOT_SIZE + SLOT_GAP);
      const y = gridY + row * (SLOT_SIZE + SLOT_GAP);

      this.slotBoxes.push(builder.addSlot(x, y, SLOT_SIZE, '', () => this.select(index)));
      // addSlot이 만든 라벨은 직접 잡을 수 없어서 가격 글자를 따로 얹는다.
      const price = scene.add
        .text(x + SLOT_SIZE / 2, y + SLOT_SIZE - 3, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        })
        .setOrigin(0.5, 1);
      builder.add(price);
      this.slotPrices.push(price);

      const icon = new SlotIcon(scene, SLOT_SIZE - ICON_INSET);
      icon.place(x + SLOT_SIZE / 2, y + SLOT_SIZE / 2 - 4, SLOT_SIZE - ICON_INSET);
      if (icon.object) builder.add(icon.object);
      this.slotIcons.push(icon);
    }

    // --- 상세: 고른 물건 하나를 크게 설명하고 그 자리에서 산다. 높이는 위에서 정해졌다.
    const detailY = gridHeight + SECTION_GAP;
    builder.addSection(0, detailY, leftWidth, detailHeight);

    const iconSize = detailHeight - SECTION_PAD * 2;
    this.detailIcon = new SlotIcon(scene, iconSize);
    this.detailIcon.place(SECTION_PAD + iconSize / 2, detailY + SECTION_PAD + iconSize / 2, iconSize);
    if (this.detailIcon.object) builder.add(this.detailIcon.object);

    const textX = SECTION_PAD * 2 + iconSize;
    this.nameText = scene.add.text(textX, detailY + SECTION_PAD, '-', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    this.rarityText = scene.add.text(textX, detailY + SECTION_PAD + 18, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.priceText = scene.add.text(textX, detailY + SECTION_PAD + 36, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    builder.add(this.nameText);
    builder.add(this.rarityText);
    builder.add(this.priceText);

    builder.addButton(
      leftWidth - SECTION_PAD - BUY_WIDTH,
      detailY + detailHeight - SECTION_PAD - BUY_HEIGHT,
      BUY_WIDTH,
      BUY_HEIGHT,
      '구매',
      () => {
        const itemId = this.stock[this.selected];
        if (itemId) this.onPurchase(itemId);
      },
    );

    // --- 판매: 창고에 든 몬스터 드랍을 **한 종류씩 통째로** 판다.
    // 개수를 고르는 UI를 만들어봐야 결국 "전부 팔기"만 쓰게 된다.
    // 판매 구역은 오른쪽 열 전체를 쓴다 — 왼쪽 두 상자와 아래 끝이 맞아야 정돈돼 보인다.
    const sellHeight = Math.max(
      SECTION_PAD * 2 + 16 + SELLABLE.length * SELL_ROW_HEIGHT,
      builder.height,
    );
    builder.addSection(rightX, 0, rightWidth, sellHeight);
    builder.addSectionTitle(rightX + SECTION_PAD, SECTION_PAD, '판매');

    SELLABLE.forEach((itemId, index) => {
      const y = SECTION_PAD + 16 + index * SELL_ROW_HEIGHT;
      const label = scene.add.text(rightX + SECTION_PAD, y + 5, '', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      });
      builder.add(label);
      this.sellLabels.set(itemId, label);

      builder.addButton(
        rightX + rightWidth - SECTION_PAD - SELL_BUTTON_WIDTH,
        y,
        SELL_BUTTON_WIDTH,
        SELL_ROW_HEIGHT - 4,
        '전부 팔기',
        () => {
          const count = this.storage[itemId] ?? 0;
          if (count > 0) this.onSell(itemId, count);
        },
      );
    });

    this.select(0);
  }

  /** 진열/자금/창고를 반영한다. HudScene이 스냅샷마다 호출한다. */
  setContext(stock: string[], money: number, storage: Record<string, number>): void {
    this.money = money;
    this.storage = storage;
    this.moneyText.setText(`${money} G`);

    if (!sameStock(this.stock, stock)) {
      this.stock = [...stock];
      this.refreshSlots();
      // 어제 고른 칸이 오늘은 다른 물건이다 — 선택을 첫 칸으로 되돌린다.
      this.select(0);
    }

    for (const [itemId, label] of this.sellLabels) {
      const count = storage[itemId] ?? 0;
      const unit = itemsData[itemId]?.sellPrice ?? 0;
      const name = itemsData[itemId]?.name ?? itemId;
      label
        .setText(`${name} ${count}개 → ${count * unit} G`)
        .setColor(count > 0 ? BODY_TEXT : DIM_TEXT);
    }
    this.refreshDetail();
  }

  private refreshSlots(): void {
    for (let index = 0; index < STOCK_SIZE; index += 1) {
      const itemId = this.stock[index];
      const item = itemId === undefined ? undefined : itemsData[itemId];

      this.slotIcons[index].setItem(itemId ?? null);
      this.slotPrices[index].setText(item?.buyPrice === undefined ? '' : `${item.buyPrice}`);
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
      this.priceText.setText('');
      this.detailIcon.setItem(null);
      return;
    }

    this.nameText.setText(item.name);

    const rarity = rarityOf(itemId);
    this.rarityText
      .setText(rarity ? RARITY[rarity].label : '')
      .setColor(rarity ? RARITY[rarity].text : DIM_TEXT);

    const price = item.buyPrice ?? 0;
    this.priceText.setText(`${price} G · ${effectSummary(itemId!)}`);
    this.priceText.setColor(this.money >= price ? BODY_TEXT : LACKING_TEXT);

    this.detailIcon.setItem(itemId ?? null);
  }
}

function rarityOf(itemId: string | undefined): ItemRarity | undefined {
  return itemId === undefined ? undefined : itemsData[itemId]?.rarity;
}

function sameStock(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((itemId, index) => itemId === b[index]);
}

/** 상세 칸 한 줄 설명. 소모품은 효과가, 무기는 종류가 살지 말지를 가른다. */
function effectSummary(itemId: string): string {
  const item = itemsData[itemId];
  if (!item) return '';
  if (item.healAmount !== undefined) return `체력 +${item.healAmount}`;
  if (item.coreHealAmount !== undefined) return `코어 +${item.coreHealAmount}`;
  if (item.energyAmount !== undefined) return `에너지 +${item.energyAmount}`;
  return '무기';
}
