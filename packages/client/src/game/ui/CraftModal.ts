import Phaser from 'phaser';
import { craftingData, itemsData, type CraftRecipe } from '@dropfall/shared';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, FONT_SMALL, PANEL_STROKE, SIZE_BODY, SIZE_SMALL } from './theme';
import { Modal } from './Modal';
import { SlotIcon, createItemIcon } from '../render/itemSprite';

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const SELECTED_STROKE = 0x6fd08c;
/** 재료가 모자랄 때의 붉은 글자. */
const LACKING_TEXT = '#d98a8a';

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 300;
const SLOT_SIZE = 48;
const SLOT_GAP = 8;
const SLOT_COLS = 4;
const DETAIL_GAP = 14;
const COST_LINE_HEIGHT = 14;
const CRAFT_WIDTH = 70;
const CRAFT_HEIGHT = 30;

/**
 * "제작" — 티어별 도구를 코어 창고의 재료로 만든다.
 *
 * 목록은 crafting.json 그대로다. **잠긴 티어의 레시피도 회색으로 보여준다** —
 * 지금 못 만드는 것을 감추면 코어를 왜 올려야 하는지 알 수 없다. 만들 수 있는지
 * 여부는 서버가 최종 판정하고(World.craftItem), 여기서는 같은 규칙으로 미리
 * 보여주기만 한다.
 */
export class CraftModal extends Modal {
  onCraft: (recipeId: string) => void = () => {};

  private readonly recipes: CraftRecipe[] = craftingData.recipes;
  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly slotLabels: Phaser.GameObjects.Text[] = [];
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly costText: Phaser.GameObjects.Text;
  private readonly tierText: Phaser.GameObjects.Text;
  private readonly detailIcon: SlotIcon;

  private selected = 0;
  /** 마지막으로 받은 창고 내용물(아이템 id → 개수)과 코어 티어. */
  private stock: Record<string, number> = {};
  private coreTier = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '제작', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    this.recipes.forEach((recipe, index) => {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = col * (SLOT_SIZE + SLOT_GAP);
      const y = row * (SLOT_SIZE + SLOT_GAP);
      const box = this.addSlot(x, y, SLOT_SIZE, '', () => this.select(index));
      this.slotBoxes.push(box);

      const icon = createItemIcon(scene, recipe.itemId, SLOT_SIZE - 14);
      if (icon) {
        icon.setPosition(x + SLOT_SIZE / 2, y + SLOT_SIZE / 2 - 4);
        this.addContent(icon);
      }

      // 칸 아래 작은 글씨는 티어다 — 아이콘만으로는 T1/T2를 구분할 수 없다.
      const label = scene.add
        .text(x + SLOT_SIZE / 2, y + SLOT_SIZE - 3, `T${recipe.requiresTier}`, {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        })
        .setOrigin(0.5, 1);
      this.addContent(label);
      this.slotLabels.push(label);
    });

    const rows = Math.ceil(this.recipes.length / SLOT_COLS);
    const detailY = rows * SLOT_SIZE + (rows - 1) * SLOT_GAP + DETAIL_GAP;

    // 스냅샷마다 다시 그리는 자리라 이미지를 새로 만들지 않고 프레임만 갈아 끼운다.
    this.detailIcon = new SlotIcon(scene, SLOT_SIZE - 8);
    this.detailIcon.place(SLOT_SIZE / 2, detailY + SLOT_SIZE / 2, SLOT_SIZE - 8);
    if (this.detailIcon.object) this.addContent(this.detailIcon.object);

    this.nameText = scene.add.text(SLOT_SIZE + 8, detailY, '-', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    this.tierText = scene.add.text(SLOT_SIZE + 8, detailY + COST_LINE_HEIGHT, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.costText = scene.add.text(0, detailY + SLOT_SIZE + 6, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.addContent(this.nameText);
    this.addContent(this.tierText);
    this.addContent(this.costText);

    this.addButton(
      this.contentWidth - CRAFT_WIDTH,
      detailY + SLOT_SIZE + 4,
      CRAFT_WIDTH,
      CRAFT_HEIGHT,
      '제작',
      () => {
        const recipe = this.recipes[this.selected];
        if (recipe) this.onCraft(recipe.id);
      },
    );

    this.select(0);
  }

  /**
   * 창고 내용과 코어 티어를 반영한다. HudScene이 스냅샷마다 호출한다 —
   * 재료를 캐 오면 모달을 다시 열지 않아도 글자가 바로 바뀐다.
   */
  setContext(stock: Record<string, number>, coreTier: number): void {
    this.stock = stock;
    this.coreTier = coreTier;

    this.recipes.forEach((recipe, index) => {
      const locked = recipe.requiresTier > coreTier;
      this.slotBoxes[index].setAlpha(locked ? 0.45 : 1);
      this.slotLabels[index].setColor(locked ? LACKING_TEXT : DIM_TEXT);
    });
    this.refreshDetail();
  }

  private select(index: number): void {
    this.selected = index;
    this.slotBoxes.forEach((box, i) =>
      box.setStrokeStyle(1, i === index ? SELECTED_STROKE : PANEL_STROKE),
    );
    this.refreshDetail();
  }

  private refreshDetail(): void {
    const recipe = this.recipes[this.selected];
    if (!recipe) return;

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
