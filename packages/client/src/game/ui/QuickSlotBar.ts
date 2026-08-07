import Phaser from 'phaser';
import { itemOfSlot } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import { SlotIcon } from '../render/itemSprite';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
} from './theme';

/** 칸 하나의 기준 크기(px). uiScale이 곱해진다. */
const SLOT_SIZE = 40;
/** 아이콘이 칸을 꽉 채우면 테두리·개수와 겹친다. 양쪽에 여백을 남긴다. */
const ICON_INSET = 10;
const SLOT_GAP = 6;
const SELECTED_STROKE = 0x6fd08c;

/** 드래그로 놓을 대상일 때의 강조색. */
const HOVER_STROKE = 0x6fd08c;

/**
 * 화면 하단 중앙의 퀵슬롯 바(와이어프레임 하단 4칸).
 *
 * 상태는 전부 스냅샷에서 온다 — 이 컴포넌트는 아무것도 기억하지 않는다.
 * 키를 눌러도 여기가 먼저 바뀌지 않고, 서버가 인정한 뒤에야 반영된다.
 *
 * 칸은 창고 모달과 **같은 드래그 공간**에 등록된다(SlotDrag) — 창고에서 집은 것을
 * 여기에 바로 놓을 수 있어야 하기 때문이다. 그래서 칸에 setInteractive를 걸어둔다.
 */
export class QuickSlotBar {
  private readonly boxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly keyLabels: Phaser.GameObjects.Text[] = [];
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private readonly countLabels: Phaser.GameObjects.Text[] = [];
  /** 칸마다 하나씩. 아이콘이 있으면 이름 라벨 대신 아이콘을 보여준다. */
  private readonly icons: SlotIcon[] = [];
  /** 레이아웃 후 실제 높이(px). 다른 요소를 이 위에 얹을 때 쓴다. */
  height = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slotCount: number,
  ) {
    for (let index = 0; index < slotCount; index += 1) {
      this.boxes.push(
        scene.add
          .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE, PANEL_FILL, 0.86)
          .setOrigin(0, 0)
          .setStrokeStyle(1, PANEL_STROKE)
          // 드래그 대상이 되려면 히트 영역이 있어야 한다. setSize로 크기가 바뀌므로
          // 레이아웃마다 히트 영역도 다시 잡아준다(layout 참고).
          .setInteractive({ useHandCursor: true }),
      );
      // 칸 번호는 곧 단축키다. 왼쪽 위 구석에 작게 박아둔다.
      this.keyLabels.push(
        scene.add.text(0, 0, `${index + 1}`, {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        }),
      );
      // 아이템 이름은 한글이라 7px로는 못 읽는다. 칸 번호·개수만 작은 폰트를 쓴다.
      this.nameLabels.push(
        scene.add
          .text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT })
          .setOrigin(0.5, 0.5),
      );
      // 아이콘은 이름 라벨보다 뒤에 만든다 — 나중에 만든 쪽이 위에 그려지므로,
      // 아이콘이 있는 칸에서 이름 라벨을 숨겨도 순서 때문에 가려지는 일이 없다.
      this.icons.push(new SlotIcon(scene, SLOT_SIZE - ICON_INSET));

      // 개수는 오른쪽 아래 — 아이템 이름과 겹치지 않는 자리다.
      this.countLabels.push(
        scene.add
          .text(0, 0, '', { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: BODY_TEXT })
          .setOrigin(1, 1),
      );
    }
  }

  /** centerX 기준 가로 정렬, bottom이 바의 아래쪽 경계다. */
  layout(centerX: number, bottom: number, scale: number): void {
    const size = SLOT_SIZE * scale;
    const gap = SLOT_GAP * scale;
    this.height = size;

    const totalWidth = size * this.slotCount + gap * (this.slotCount - 1);
    const startX = centerX - totalWidth / 2;
    const top = bottom - size;

    for (let index = 0; index < this.slotCount; index += 1) {
      const x = startX + index * (size + gap);
      const box = this.boxes[index];
      box.setSize(size, size).setPosition(x, top);
      // setSize는 히트 영역을 갱신하지 않는다 — UI 배율이 바뀌면 클릭 판정이 어긋난다.
      box.input?.hitArea?.setSize(size, size);
      this.keyLabels[index].setFontSize(SIZE_SMALL * scale).setPosition(x + 3 * scale, top + 2 * scale);
      this.nameLabels[index].setFontSize(SIZE_BODY * scale).setPosition(x + size / 2, top + size / 2);
      this.icons[index].place(x + size / 2, top + size / 2, size - ICON_INSET * scale);
      this.countLabels[index]
        .setFontSize(SIZE_SMALL * scale)
        .setPosition(x + size - 3 * scale, top + size - 2 * scale);
    }
  }

  /** 드래그 컨트롤러(SlotDrag)에 등록할 칸 목록. */
  get cells(): readonly Phaser.GameObjects.Rectangle[] {
    return this.boxes;
  }

  /**
   * @param hoverIndex 드래그로 놓을 대상 칸. 선택 강조보다 우선한다 —
   *   지금 손에 든 것이 어디로 갈지가 더 급한 정보다.
   */
  update(me: PlayerView | undefined, hoverIndex: number | null = null): void {
    for (let index = 0; index < this.slotCount; index += 1) {
      const slot = me?.slots[index] ?? null;
      const item = itemOfSlot(slot);
      const isSelected = me?.selectedSlot === index;
      const isHovered = hoverIndex === index;

      // 아이콘이 있으면 그림만 보여준다 — 좁은 칸에서 그림과 글자가 겹치면 둘 다 못 읽는다.
      this.icons[index].setItem(slot?.itemId ?? null);
      this.nameLabels[index].setText(this.icons[index].isShowing ? '' : (item?.name ?? ''));
      // 1개짜리(무기)는 개수를 안 띄운다 — 항상 "1"이면 정보가 아니라 잡음이다.
      this.countLabels[index].setText(slot && slot.count > 1 ? `${slot.count}` : '');

      if (isHovered) this.boxes[index].setStrokeStyle(2, HOVER_STROKE);
      else if (isSelected) this.boxes[index].setStrokeStyle(2, SELECTED_STROKE);
      else this.boxes[index].setStrokeStyle(1, PANEL_STROKE);

      this.keyLabels[index].setColor(isSelected ? ACCENT : DIM_TEXT);
    }
  }
}
