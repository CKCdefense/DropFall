import Phaser from 'phaser';
import { STORAGE_SLOT_COUNT, itemOfSlot, type InventorySlot } from '@dropfall/shared';
import { Modal } from './Modal';
import { BODY_TEXT, DIM_TEXT, FONT_SMALL, PANEL_STROKE, SIZE_SMALL } from './theme';

const CELL = 26;
const CELL_GAP = 3;
const COLUMNS = 5;
const ROWS = Math.ceil(STORAGE_SLOT_COUNT / COLUMNS);

const PANEL_WIDTH = COLUMNS * (CELL + CELL_GAP) - CELL_GAP + 20;
const PANEL_HEIGHT = 28 + 14 + ROWS * (CELL + CELL_GAP) + 10;

export interface StorageCellHandle {
  index: number;
  box: Phaser.GameObjects.Rectangle;
}

/**
 * 코어 창고 모달 — 창고 격자만 보여준다.
 *
 * **내 인벤토리 격자가 여기 없는 이유**: 화면 하단 퀵슬롯 HUD가 이미 인벤토리다.
 * 모달 안에 사본을 또 그리면 "어느 쪽이 진짜냐"부터 헷갈린다. 드래그는 공용 컨트롤러
 * (SlotDrag)가 처리해서 창고 칸 ↔ 퀵슬롯 HUD 사이를 바로 오간다 — 그래서 이 모달은
 * 차단막 없이 떠 있고(Modal 참고) 퀵슬롯이 가려지면 제목 줄을 잡아 옮기면 된다.
 */
export class WarehouseModal extends Modal {
  private readonly cells: StorageCellHandle[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly counts: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '창고', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    this.addContent(
      scene.add.text(0, 0, '코어 창고  (퀵슬롯으로 끌어서 옮기기)', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
      }),
    );

    for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) {
      const x = (index % COLUMNS) * (CELL + CELL_GAP);
      const y = 14 + Math.floor(index / COLUMNS) * (CELL + CELL_GAP);

      const box = this.scene.add
        .rectangle(x, y, CELL, CELL, 0x000000, 0.25)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });

      const label = this.scene.add
        .text(x + CELL / 2, y + CELL / 2, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);

      const count = this.scene.add
        .text(x + CELL - 2, y + CELL - 1, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
        })
        .setOrigin(1, 1);

      this.addContent(box);
      this.addContent(label);
      this.addContent(count);

      this.cells.push({ index, box });
      this.labels.push(label);
      this.counts.push(count);
    }
  }

  /** 드래그 컨트롤러(SlotDrag)에 등록할 칸 목록. */
  get storageCells(): readonly StorageCellHandle[] {
    return this.cells;
  }

  /** 스냅샷마다 호출된다. */
  setSlots(storage: (InventorySlot | null)[]): void {
    for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) {
      const slot = storage[index] ?? null;
      const item = itemOfSlot(slot);
      // 칸이 좁아서 이름 두 글자만 보여준다 — 아이콘이 들어오면 이 자리를 대체한다.
      this.labels[index].setText(item ? item.name.slice(0, 2) : '');
      this.counts[index].setText(slot && slot.count > 1 ? String(slot.count) : '');
    }
  }
}
