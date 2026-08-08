import Phaser from 'phaser';
import { craftingData, itemsData, type CraftRecipe } from '@dropfall/shared';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, PANEL_STROKE, SIZE_BODY } from './theme';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const SELECTED_STROKE = 0x6fd08c;
/** 재료가 모자랄 때의 붉은 글자. */
const LACKING_TEXT = '#d98a8a';

const SLOT_SIZE = 62;
const SLOT_GAP = 10;
const SLOT_COLS = 4;
const SECTION_PAD = 12;
const SECTION_GAP = 10;
/** 티어 고르는 왼쪽 열의 폭과 버튼 높이. */
const TIER_WIDTH = 96;
const TIER_BUTTON_HEIGHT = 34;
const TIER_BUTTON_GAP = 8;
const DETAIL_HEIGHT = 92;
const CRAFT_WIDTH = 84;
const CRAFT_HEIGHT = 32;

/** 레시피에 등장하는 티어들(오름차순). 데이터가 늘면 버튼도 따라 늘어난다. */
const TIERS = [...new Set(craftingData.recipes.map((recipe) => recipe.requiresTier))].sort(
  (a, b) => a - b,
);

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
  private readonly tierButtons: (Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle)[] = [];
  private readonly tierLabels: Phaser.GameObjects.Text[] = [];
  /** 격자 칸은 티어를 바꿀 때 내용만 갈아 끼운다 — 티어마다 다시 만들면 선택이 풀린다. */
  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly slotIcons: SlotIcon[] = [];
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly costText: Phaser.GameObjects.Text;
  private readonly tierText: Phaser.GameObjects.Text;
  private readonly detailIcon: SlotIcon;

  /** 지금 보고 있는 티어와, 그 티어 안에서 고른 칸. */
  private tier = TIERS[0] ?? 1;
  private selected = 0;
  /** 마지막으로 받은 창고 내용물(아이템 id → 개수)과 코어 티어. */
  private stock: Record<string, number> = {};
  private coreTier = 0;

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    const gridX = TIER_WIDTH + SECTION_GAP;
    const gridWidth = builder.width - gridX;
    const gridRows = Math.ceil(this.maxRecipesPerTier() / SLOT_COLS);
    // 위 구역의 높이는 **격자와 티어 열 중 큰 쪽**이다. 격자만 보고 잡으면 티어가
    // 넷 이상일 때 마지막 버튼이 상자 밖으로 나가 아래 구역에 가려진다(실제로 그랬다).
    const tierHeight =
      SECTION_PAD * 2 + TIERS.length * TIER_BUTTON_HEIGHT + (TIERS.length - 1) * TIER_BUTTON_GAP;
    const topHeight = Math.max(
      SECTION_PAD * 2 + gridRows * SLOT_SIZE + (gridRows - 1) * SLOT_GAP,
      tierHeight,
    );

    // --- 왼쪽: 티어 고르기. 격자와 같은 높이의 상자로 세워 둔다.
    builder.addSection(0, 0, TIER_WIDTH, topHeight);
    TIERS.forEach((tier, index) => {
      const y = SECTION_PAD + index * (TIER_BUTTON_HEIGHT + TIER_BUTTON_GAP);
      const button = builder.addButton(
        SECTION_PAD,
        y,
        TIER_WIDTH - SECTION_PAD * 2,
        TIER_BUTTON_HEIGHT,
        '',
        () => this.selectTier(tier),
      );
      this.tierButtons.push(button);

      const label = scene.add
        .text(TIER_WIDTH / 2, y + TIER_BUTTON_HEIGHT / 2, `Tier ${tier}`, {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);
      builder.add(label);
      this.tierLabels.push(label);
    });

    // --- 오른쪽: 그 티어의 물건들.
    builder.addSection(gridX, 0, gridWidth, topHeight);
    for (let index = 0; index < this.maxRecipesPerTier(); index += 1) {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = gridX + SECTION_PAD + col * (SLOT_SIZE + SLOT_GAP);
      const y = SECTION_PAD + row * (SLOT_SIZE + SLOT_GAP);

      const box = builder.addSlot(x, y, SLOT_SIZE, '', () => this.select(index));
      this.slotBoxes.push(box);

      const icon = new SlotIcon(scene, SLOT_SIZE - 16);
      icon.place(x + SLOT_SIZE / 2, y + SLOT_SIZE / 2, SLOT_SIZE - 16);
      if (icon.object) builder.add(icon.object);
      this.slotIcons.push(icon);
    }

    // --- 아래: 고른 것 하나를 설명하고 그 자리에서 만든다.
    // 상세는 남은 높이를 전부 쓴다 — 고정 높이로 두면 판 아래가 통째로 빈다.
    const detailY = topHeight + SECTION_GAP;
    const detailHeight = Math.max(DETAIL_HEIGHT, builder.height - detailY);
    builder.addSection(0, detailY, builder.width, detailHeight);

    const iconSize = DETAIL_HEIGHT - SECTION_PAD * 2;
    this.detailIcon = new SlotIcon(scene, iconSize);
    this.detailIcon.place(SECTION_PAD + iconSize / 2, detailY + SECTION_PAD + iconSize / 2, iconSize);
    if (this.detailIcon.object) builder.add(this.detailIcon.object);

    const textX = SECTION_PAD * 2 + iconSize;
    this.nameText = scene.add.text(textX, detailY + SECTION_PAD, '-', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    this.tierText = scene.add.text(textX, detailY + SECTION_PAD + 20, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.costText = scene.add.text(textX, detailY + SECTION_PAD + 40, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    builder.add(this.nameText);
    builder.add(this.tierText);
    builder.add(this.costText);

    builder.addButton(
      builder.width - SECTION_PAD - CRAFT_WIDTH,
      detailY + detailHeight - SECTION_PAD - CRAFT_HEIGHT,
      CRAFT_WIDTH,
      CRAFT_HEIGHT,
      '제작',
      () => {
        const recipe = this.visibleRecipes()[this.selected];
        if (recipe) this.onCraft(recipe.id);
      },
    );

    this.selectTier(this.tier);
  }

  /** 한 티어에 들어갈 수 있는 최대 레시피 수 = 격자 칸 수. */
  private maxRecipesPerTier(): number {
    return Math.max(...TIERS.map((tier) => this.recipesOfTier(tier).length));
  }

  private recipesOfTier(tier: number): CraftRecipe[] {
    return this.recipes.filter((recipe) => recipe.requiresTier === tier);
  }

  private visibleRecipes(): CraftRecipe[] {
    return this.recipesOfTier(this.tier);
  }

  /**
   * 창고 내용과 코어 티어를 반영한다. HudScene이 스냅샷마다 호출한다 —
   * 재료를 캐 오면 모달을 다시 열지 않아도 글자가 바로 바뀐다.
   */
  setContext(stock: Record<string, number>, coreTier: number): void {
    this.stock = stock;
    this.coreTier = coreTier;
    this.refreshTiers();
    this.refreshDetail();
  }

  private selectTier(tier: number): void {
    this.tier = tier;
    this.selected = 0;
    this.refreshTiers();
    this.refreshGrid();
    this.refreshDetail();
  }

  /** 잠긴 티어는 흐리게 — 버튼은 남겨두어 "코어를 올리면 열린다"를 계속 보여준다. */
  private refreshTiers(): void {
    TIERS.forEach((tier, index) => {
      const locked = tier > this.coreTier;
      const active = tier === this.tier;
      this.tierLabels[index]!.setColor(active ? ACCENT : locked ? LACKING_TEXT : BODY_TEXT);
      this.tierButtons[index]!.setAlpha(locked ? 0.55 : 1);
    });
  }

  /** 격자를 지금 티어의 레시피로 채운다. 남는 칸은 비워 둔다(칸 수는 티어마다 다르다). */
  private refreshGrid(): void {
    const recipes = this.visibleRecipes();
    this.slotBoxes.forEach((box, index) => {
      const recipe = recipes[index];
      box.setVisible(recipe !== undefined);
      this.slotIcons[index]!.setItem(recipe ? recipe.itemId : null);
      box.setStrokeStyle(1, index === this.selected ? SELECTED_STROKE : PANEL_STROKE);
    });
  }

  private select(index: number): void {
    if (index >= this.visibleRecipes().length) return;
    this.selected = index;
    this.refreshGrid();
    this.refreshDetail();
  }

  private refreshDetail(): void {
    const recipe = this.visibleRecipes()[this.selected];
    if (!recipe) {
      this.nameText.setText('-');
      this.tierText.setText('');
      this.costText.setText('');
      this.detailIcon.setItem(null);
      return;
    }

    this.nameText.setText(itemsData[recipe.itemId]?.name ?? recipe.itemId);

    const locked = recipe.requiresTier > this.coreTier;
    this.tierText
      .setText(locked ? `코어 티어 ${recipe.requiresTier} 필요` : '제작 가능')
      .setColor(locked ? LACKING_TEXT : ACCENT);

    // 가진 만큼/필요한 만큼을 같이 보여준다 — 모자란 재료가 뭔지 바로 알 수 있어야 한다.
    const lines = Object.entries(recipe.cost).map(([itemId, need]) => {
      const have = this.stock[itemId] ?? 0;
      return `${itemsData[itemId]?.name ?? itemId} ${have}/${need}`;
    });
    const lacking = Object.entries(recipe.cost).some(
      ([itemId, need]) => (this.stock[itemId] ?? 0) < need,
    );
    this.costText.setText(lines.join('   ')).setColor(lacking ? LACKING_TEXT : BODY_TEXT);

    this.detailIcon.setItem(recipe.itemId);
  }
}
