import Phaser from 'phaser';
import { BODY_TEXT, DIM_TEXT, FONT, PANEL_FILL, PANEL_STROKE, SIZE_BODY } from './theme';
import { Modal } from './Modal';

/** ACCENT('#6fd08c')의 숫자판 — setStrokeStyle은 숫자 색만 받는다. */
const SELECTED_STROKE = 0x6fd08c;
const PANEL_WIDTH = 260;
const PANEL_HEIGHT = 210;
const SLOT_SIZE = 48;
const SLOT_GAP = 8;
const SLOT_COLS = 3;
const SLOT_ROWS = 2;
const DETAIL_GAP = 12;
const DETAIL_ICON_SIZE = 40;
const CRAFT_WIDTH = 70;
const CRAFT_HEIGHT = 30;

/**
 * "제작" 목적지. 와이어프레임 원본에서 이 화면은 잘려서 안 보였다 — StoreModal과 같은
 * "칸 그리드 + 하단 상세" 뼈대를 그대로 따른다(제작도 결국 칸에서 골라 확정하는 흐름).
 */
export class CraftModal extends Modal {
  onSelectSlot: (index: number) => void = () => {};
  onCraft: () => void = () => {};

  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '제작', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    for (let index = 0; index < SLOT_COLS * SLOT_ROWS; index += 1) {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = col * (SLOT_SIZE + SLOT_GAP);
      const y = row * (SLOT_SIZE + SLOT_GAP);
      const box = this.addSlot(x, y, SLOT_SIZE, '재료: -', () => this.selectSlot(index));
      this.slotBoxes.push(box);
    }

    const gridBottom = SLOT_ROWS * SLOT_SIZE + (SLOT_ROWS - 1) * SLOT_GAP;
    const detailY = gridBottom + DETAIL_GAP;

    const iconBox = scene.add
      .rectangle(0, detailY, DETAIL_ICON_SIZE, DETAIL_ICON_SIZE, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    const nameText = scene.add.text(DETAIL_ICON_SIZE + 8, detailY, '이름: -', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    const descText = scene.add.text(DETAIL_ICON_SIZE + 8, detailY + 16, '설명: -', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.content.add([iconBox, nameText, descText]);

    this.addButton(
      this.contentWidth - CRAFT_WIDTH,
      detailY + (DETAIL_ICON_SIZE - CRAFT_HEIGHT) / 2,
      CRAFT_WIDTH,
      CRAFT_HEIGHT,
      '제작',
      () => this.onCraft(),
    );
  }

  private selectSlot(index: number): void {
    this.slotBoxes.forEach((box, i) => box.setStrokeStyle(1, i === index ? SELECTED_STROKE : PANEL_STROKE));
    this.onSelectSlot(index);
  }
}
