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
const BUY_WIDTH = 70;
const BUY_HEIGHT = 30;

/**
 * "상점" 목적지 — 3x2 칸 그리드 + 선택한 칸의 상세(아이콘/이름/상점가) + 구매 버튼.
 * 실제 아이템 데이터가 없어서 칸은 전부 동일한 자리표시자다. 선택 상태는 테두리 색으로만
 * 표시하고, 어떤 아이템인지는 onSelectSlot을 받는 쪽(나중에 배선)이 채운다.
 */
export class StoreModal extends Modal {
  onSelectSlot: (index: number) => void = () => {};
  onPurchase: () => void = () => {};

  private readonly slotBoxes: Phaser.GameObjects.Rectangle[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '상점', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    for (let index = 0; index < SLOT_COLS * SLOT_ROWS; index += 1) {
      const col = index % SLOT_COLS;
      const row = Math.floor(index / SLOT_COLS);
      const x = col * (SLOT_SIZE + SLOT_GAP);
      const y = row * (SLOT_SIZE + SLOT_GAP);
      const box = this.addSlot(x, y, SLOT_SIZE, '가격: -', () => this.selectSlot(index));
      this.slotBoxes.push(box);
    }

    const gridBottom = SLOT_ROWS * SLOT_SIZE + (SLOT_ROWS - 1) * SLOT_GAP;
    const detailY = gridBottom + DETAIL_GAP;

    // 아이콘 자리표시자 + 이름/상점가 두 줄. 슬롯과 달리 한 번만 쓰이므로 헬퍼로 안 뺐다.
    const iconBox = scene.add
      .rectangle(0, detailY, DETAIL_ICON_SIZE, DETAIL_ICON_SIZE, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    const nameText = scene.add.text(DETAIL_ICON_SIZE + 8, detailY, '이름: -', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    const shopText = scene.add.text(DETAIL_ICON_SIZE + 8, detailY + 16, '상점: -', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.content.add([iconBox, nameText, shopText]);

    this.addButton(
      this.contentWidth - BUY_WIDTH,
      detailY + (DETAIL_ICON_SIZE - BUY_HEIGHT) / 2,
      BUY_WIDTH,
      BUY_HEIGHT,
      '구매',
      () => this.onPurchase(),
    );
  }

  private selectSlot(index: number): void {
    this.slotBoxes.forEach((box, i) => box.setStrokeStyle(1, i === index ? SELECTED_STROKE : PANEL_STROKE));
    this.onSelectSlot(index);
  }
}
