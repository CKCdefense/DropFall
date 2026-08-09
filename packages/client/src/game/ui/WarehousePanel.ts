import Phaser from 'phaser';
import { STORAGE_SLOT_COUNT, itemOfSlot, type InventorySlot } from '@dropfall/shared';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';
import {
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
  forceSetText,
} from './theme';

const CELL = 62;
/** 아이콘이 칸 테두리·개수 글자와 겹치지 않게 남기는 여백(px). */
const ICON_INSET = 12;
const CELL_GAP = 8;
const COLUMNS = 5;
const SECTION_PAD = 12;
const SECTION_GAP = 10;
/** 아래 줄(고른 칸 설명 + 폐기) 높이. */
const FOOTER_HEIGHT = 44;
const DISCARD_WIDTH = 84;
const DISCARD_HEIGHT = 32;
/** ACCENT('#6fd08c')의 숫자판 — 고른 칸 테두리에 쓴다. */
const SELECTED_STROKE = 0x6fd08c;

export interface StorageCellHandle {
  index: number;
  box: Phaser.GameObjects.Rectangle;
}

/**
 * 코어 창고 탭 — 창고 격자만 보여준다.
 *
 * **내 인벤토리 격자가 여기 없는 이유**: 화면 하단 퀵슬롯 HUD가 이미 인벤토리다.
 * 탭 안에 사본을 또 그리면 "어느 쪽이 진짜냐"부터 헷갈린다. 드래그는 공용 컨트롤러
 * (SlotDrag)가 처리해서 창고 칸 ↔ 퀵슬롯 HUD 사이를 바로 오간다 — 그래서 이 창은
 * 차단막 없이 떠 있고(Modal 참고) 퀵슬롯이 가려지면 상단 탭 줄을 잡아 옮기면 된다.
 */
export class WarehousePanel {
  private readonly cells: StorageCellHandle[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly counts: Phaser.GameObjects.Text[] = [];
  private readonly icons: SlotIcon[] = [];

  /** 폐기 대상. 칸을 눌러 고른다 — 드래그로 옮기는 것과 구분되는 별도의 선택이다. */
  private selected = -1;
  private readonly selectedText: Phaser.GameObjects.Text;

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    const rows = Math.ceil(STORAGE_SLOT_COUNT / COLUMNS);
    const gridWidth = COLUMNS * CELL + (COLUMNS - 1) * CELL_GAP;
    // 폐기 줄은 판 **아래에 붙이고**, 격자 상자가 남은 높이를 전부 쓴다.
    const footerY = Math.max(
      SECTION_PAD * 2 + 16 + rows * CELL + (rows - 1) * CELL_GAP + SECTION_GAP,
      builder.height - FOOTER_HEIGHT,
    );
    const gridHeight = footerY - SECTION_GAP;

    builder.addSection(0, 0, builder.width, gridHeight);
    builder.addSectionTitle(SECTION_PAD, SECTION_PAD, '코어 창고  (퀵슬롯으로 끌어서 옮기기)');

    // 격자는 상자 안에서 가운데 정렬한다 — 칸을 키운 뒤에도 좌우 여백이 같아야 정돈돼 보인다.
    const gridX = Math.round((builder.width - gridWidth) / 2);
    const gridY = SECTION_PAD + 16;

    for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) {
      const x = gridX + (index % COLUMNS) * (CELL + CELL_GAP);
      const y = gridY + Math.floor(index / COLUMNS) * (CELL + CELL_GAP);

      const box = scene.add
        .rectangle(x, y, CELL, CELL, 0x000000, 0.25)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });
      // 누르면 고른다. 드래그는 SlotDrag가 같은 사각형 위에서 따로 처리한다 —
      // 눌렀다 그 자리에서 떼면 선택, 끌면 이동이라 서로 방해하지 않는다.
      box.on('pointerdown', () => this.select(index));

      const label = scene.add
        .text(x + CELL / 2, y + CELL / 2, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);

      const icon = new SlotIcon(scene, CELL - ICON_INSET);
      icon.place(x + CELL / 2, y + CELL / 2, CELL - ICON_INSET);

      const count = scene.add
        .text(x + CELL - 3, y + CELL - 2, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
        })
        .setOrigin(1, 1);

      builder.add(box);
      builder.add(label);
      if (icon.object) builder.add(icon.object);
      builder.add(count);

      this.cells.push({ index, box });
      this.labels.push(label);
      this.icons.push(icon);
      this.counts.push(count);
    }

    // --- 아래: 고른 칸을 알려주고 그 칸을 비운다.
    builder.addSection(0, footerY, builder.width, FOOTER_HEIGHT);

    this.selectedText = scene.add.text(SECTION_PAD, footerY + FOOTER_HEIGHT / 2, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: DIM_TEXT,
    });
    this.selectedText.setOrigin(0, 0.5);
    builder.add(this.selectedText);

    builder.addButton(
      builder.width - SECTION_PAD - DISCARD_WIDTH,
      footerY + (FOOTER_HEIGHT - DISCARD_HEIGHT) / 2,
      DISCARD_WIDTH,
      DISCARD_HEIGHT,
      '폐기',
      () => {
        if (this.selected >= 0) this.onDiscard(this.selected);
      },
    );

    this.refreshSelection();
  }

  /** 폐기 요청. 서버가 실제로 비우고, 내용물은 바닥에 떨어진다(World.discardFromStorage). */
  onDiscard: (index: number) => void = () => {};

  private select(index: number): void {
    // 같은 칸을 다시 누르면 선택을 푼다 — 실수로 고른 채 폐기를 누르는 일을 줄인다.
    this.selected = this.selected === index ? -1 : index;
    this.refreshSelection();
  }

  private refreshSelection(): void {
    this.cells.forEach(({ box }, index) => {
      box.setStrokeStyle(1, index === this.selected ? SELECTED_STROKE : PANEL_STROKE);
    });
    const name = this.selected >= 0 ? this.selectedName : '';
    this.selectedText.setText(name ? `선택: ${name}` : '칸을 눌러 고르면 폐기할 수 있다');
  }

  /** 마지막으로 반영된 선택 칸의 이름. setSlots가 갱신한다. */
  private selectedName = '';

  /** 드래그 컨트롤러(SlotDrag)에 등록할 칸 목록. */
  get storageCells(): readonly StorageCellHandle[] {
    return this.cells;
  }

  /** 스냅샷마다 호출된다. */
  setSlots(storage: (InventorySlot | null)[]): void {
    for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) {
      const slot = storage[index] ?? null;
      const item = itemOfSlot(slot);
      // 아이콘이 있으면 그림이 이름을 대신한다. 없을 때만 이름 두 글자로 버틴다.
      this.icons[index].setItem(slot?.itemId ?? null);
      const showIcon = this.icons[index].isShowing;
      // setText()만으로는 드물게 화면이 안 갱신되고 이전 글자에 멈추는 경우가
      // 있었다(코어 충전 칸에서 실측·재현, CorePanel.setChargeSlots 참고) —
      // 같은 패턴(칸 여러 개를 매 프레임 setText로 채움)이라 여기도 forceSetText로 바꾼다.
      forceSetText(this.labels[index], showIcon || !item ? '' : item.name.slice(0, 2));
      this.counts[index].setText(slot && slot.count > 1 ? String(slot.count) : '');
    }

    // 고른 칸이 비었으면(옮겨졌거나 폐기됐다) 선택을 놓는다 — 빈 칸을 고른 채로 두면
    // "폐기" 버튼이 아무 일도 안 하는 이유를 알 수 없다.
    const selectedSlot = this.selected >= 0 ? (storage[this.selected] ?? null) : null;
    if (this.selected >= 0 && !selectedSlot) this.selected = -1;
    this.selectedName = selectedSlot ? (itemOfSlot(selectedSlot)?.name ?? selectedSlot.itemId) : '';
    this.refreshSelection();
  }
}
