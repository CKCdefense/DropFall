import Phaser from 'phaser';
import { STORAGE_SLOT_COUNT, itemOfSlot, type InventorySlot } from '@dropfall/shared';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';
import { HUD_ATLAS, ICON_TRASH } from './hudBar';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  forceSetText,
} from './theme';

/**
 * 창고 칸.
 *
 * 상점 진열과 같은 이유로 크게 잡는다 — 격자가 판 폭을 꽉 채워야 "여기가 창고"로
 * 읽히고, 무엇이 들었는지도 그림만으로 알 수 있다.
 */
const CELL = 88;
/** 아이콘이 칸 테두리·개수 글자와 겹치지 않게 남기는 여백(px). */
const ICON_INSET = 18;
const CELL_GAP = 10;
const COLUMNS = 5;
const SECTION_PAD = 12;
const SECTION_GAP = 10;

/**
 * 아래 폐기 구역.
 *
 * 버튼이 아니라 **놓는 자리**다. 예전에는 칸을 눌러 고르고 오른쪽 "폐기" 버튼을 누르는
 * 두 단계였는데, 창고에서 물건을 옮기는 몸짓은 이미 드래그앤드롭이라 버리는 것만 다른
 * 문법이었다. 휴지통에 끌어다 놓는 쪽이 손에 붙고, **인벤토리에서 바로** 버릴 수도
 * 있다(예전에는 창고에 넣은 뒤에야 버릴 수 있었다).
 */
const TRASH_HEIGHT = 76;
/** 휴지통 그림 크기(원본 16px의 정수배). */
const TRASH_ICON = 48;
/** 물건을 든 채 위에 올렸을 때. 놓으면 사라지는 자리라 붉게 말해 준다. */
const TRASH_ARMED = 0xd9756b;

export interface StorageCellHandle {
  index: number;
  box: Phaser.GameObjects.Rectangle;
}

/**
 * 코어 창고 탭 — 창고 격자 + 아래 폐기 구역.
 *
 * **내 인벤토리 격자가 여기 없는 이유**: 화면 하단 퀵슬롯 HUD가 이미 인벤토리다.
 * 탭 안에 사본을 또 그리면 "어느 쪽이 진짜냐"부터 헷갈린다. 드래그는 공용 컨트롤러
 * (SlotDrag)가 처리해서 창고 칸 ↔ 퀵슬롯 HUD 사이를 바로 오간다 — 그래서 이 창은
 * 차단막 없이 떠 있고(Modal 참고) 퀵슬롯이 가려지면 상단 탭 줄을 잡아 옮기면 된다.
 * 폐기 구역도 같은 컨트롤러가 "놓을 자리" 중 하나로 다룬다.
 */
export class WarehousePanel {
  private readonly cells: StorageCellHandle[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private readonly counts: Phaser.GameObjects.Text[] = [];
  private readonly icons: SlotIcon[] = [];

  private readonly trashBox: Phaser.GameObjects.Rectangle;
  private readonly trashText: Phaser.GameObjects.Text;

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    const rows = Math.ceil(STORAGE_SLOT_COUNT / COLUMNS);
    const gridWidth = COLUMNS * CELL + (COLUMNS - 1) * CELL_GAP;
    // 폐기 구역은 판 **아래에 붙이고**, 격자 상자가 남은 높이를 전부 쓴다.
    const trashY = Math.max(
      SECTION_PAD * 2 + rows * CELL + (rows - 1) * CELL_GAP + SECTION_GAP,
      builder.height - TRASH_HEIGHT,
    );
    const gridHeight = trashY - SECTION_GAP;

    // 제목을 달지 않는다. "코어 창고"는 탭 이름이 이미 말했고, "끌어서 옮기기"는 칸을
    // 한 번 집어 보면 아는 것이라 매번 읽힐 자리를 차지할 이유가 없다.
    builder.addSection(0, 0, builder.width, gridHeight);

    // 격자는 상자 안에서 **가로세로 모두** 가운데로 놓는다 — 제목이 빠지면서 남은
    // 높이가 아래에 빈 띠로 몰리면 격자가 위로 쏠려 보인다.
    const gridX = Math.round((builder.width - gridWidth) / 2);
    const gridBlock = rows * CELL + (rows - 1) * CELL_GAP;
    const gridY = Math.max(SECTION_PAD, Math.round((gridHeight - gridBlock) / 2));

    for (let index = 0; index < STORAGE_SLOT_COUNT; index += 1) {
      const x = gridX + (index % COLUMNS) * (CELL + CELL_GAP);
      const y = gridY + Math.floor(index / COLUMNS) * (CELL + CELL_GAP);

      const box = scene.add
        .rectangle(x, y, CELL, CELL, 0x000000, 0.25)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });

      const label = scene.add
        .text(x + CELL / 2, y + CELL / 2, '', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          color: BODY_TEXT,
        })
        .setOrigin(0.5, 0.5);

      const icon = new SlotIcon(scene, CELL - ICON_INSET);
      icon.place(x + CELL / 2, y + CELL / 2, CELL - ICON_INSET);

      const count = scene.add
        .text(x + CELL - 5, y + CELL - 4, '', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
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

    // --- 아래: 폐기 구역. 상자 하나가 통째로 놓는 자리라 안쪽에 버튼을 두지 않는다.
    this.trashBox = scene.add
      .rectangle(0, trashY, builder.width, TRASH_HEIGHT, PANEL_FILL, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      // SlotDrag가 놓을 자리로 쓰려면 칸이 interactive여야 한다(집기는 막혀 있다 —
      // getSlot이 이 칸에 대해 항상 null을 돌려주므로 여기서 끌어낼 수는 없다).
      .setInteractive();
    builder.add(this.trashBox);

    const midY = trashY + TRASH_HEIGHT / 2;
    const hasIcon = scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(ICON_TRASH);
    let textX = SECTION_PAD * 2;
    if (hasIcon) {
      const source = scene.textures.get(HUD_ATLAS).get(ICON_TRASH);
      const image = scene.add
        .image(SECTION_PAD * 2, midY, HUD_ATLAS, ICON_TRASH)
        .setOrigin(0, 0.5)
        // 픽셀아트는 정수배로만 키운다 — 16px 그림을 3배로 쓴다.
        .setScale(TRASH_ICON / source.height);
      builder.add(image);
      textX = SECTION_PAD * 2 + TRASH_ICON + SECTION_PAD;
    }

    this.trashText = scene.add
      .text(textX, midY, '', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: DIM_TEXT,
      })
      .setOrigin(0, 0.5);
    builder.add(this.trashText);

    this.setTrashArmed(false);
  }

  /**
   * 폐기 칸 손잡이. SlotDrag가 **놓을 자리**로 등록한다 — 인덱스는 쓰이지 않지만
   * 다른 칸과 같은 모양이어야 컨트롤러가 특별 취급하지 않는다.
   */
  get trashCell(): Phaser.GameObjects.Rectangle {
    return this.trashBox;
  }

  /**
   * 물건을 든 손이 폐기 칸 위에 있는가. SlotDrag가 매 이동마다 알려준다 —
   * 놓으면 사라지는 자리라 "지금 놓으면 버려진다"를 놓기 **전에** 말해야 한다.
   */
  setTrashArmed(armed: boolean): void {
    this.trashBox.setStrokeStyle(armed ? 2 : 1, armed ? TRASH_ARMED : PANEL_STROKE);
    this.trashText
      .setText(armed ? '놓으면 발밑에 버린다' : '여기로 끌어다 놓으면 버린다')
      .setColor(armed ? ACCENT : DIM_TEXT);
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
      // 아이콘이 있으면 그림이 이름을 대신한다. 없을 때만 이름 두 글자로 버틴다.
      this.icons[index].setItem(slot?.itemId ?? null);
      const showIcon = this.icons[index].isShowing;
      // setText()만으로는 드물게 화면이 안 갱신되고 이전 글자에 멈추는 경우가
      // 있었다(코어 충전 칸에서 실측·재현, CorePanel.setChargeSlots 참고) —
      // 같은 패턴(칸 여러 개를 매 프레임 setText로 채움)이라 여기도 forceSetText로 바꾼다.
      forceSetText(this.labels[index], showIcon || !item ? '' : item.name.slice(0, 2));
      this.counts[index].setText(slot && slot.count > 1 ? String(slot.count) : '');
    }
  }
}
