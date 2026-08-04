import Phaser from 'phaser';
import { itemOfSlot } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
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
const SLOT_GAP = 6;
const SELECTED_STROKE = 0x6fd08c;

/**
 * 화면 하단 중앙의 퀵슬롯 바(와이어프레임 하단 4칸).
 *
 * 상태는 전부 스냅샷에서 온다 — 이 컴포넌트는 아무것도 기억하지 않는다.
 * 키를 눌러도 여기가 먼저 바뀌지 않고, 서버가 인정한 뒤에야 반영된다.
 */
export class QuickSlotBar {
  private readonly boxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly keyLabels: Phaser.GameObjects.Text[] = [];
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private readonly countLabels: Phaser.GameObjects.Text[] = [];
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
          .setStrokeStyle(1, PANEL_STROKE),
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
      this.boxes[index].setSize(size, size).setPosition(x, top);
      this.keyLabels[index].setFontSize(SIZE_SMALL * scale).setPosition(x + 3 * scale, top + 2 * scale);
      this.nameLabels[index].setFontSize(SIZE_BODY * scale).setPosition(x + size / 2, top + size / 2);
      this.countLabels[index]
        .setFontSize(SIZE_SMALL * scale)
        .setPosition(x + size - 3 * scale, top + size - 2 * scale);
    }
  }

  update(me: PlayerView | undefined): void {
    for (let index = 0; index < this.slotCount; index += 1) {
      const slot = me?.slots[index] ?? null;
      const item = itemOfSlot(slot);
      const isSelected = me?.selectedSlot === index;

      this.nameLabels[index].setText(item?.name ?? '');
      // 1개짜리(무기)는 개수를 안 띄운다 — 항상 "1"이면 정보가 아니라 잡음이다.
      this.countLabels[index].setText(slot && slot.count > 1 ? `${slot.count}` : '');

      this.boxes[index].setStrokeStyle(isSelected ? 2 : 1, isSelected ? SELECTED_STROKE : PANEL_STROKE);
      this.keyLabels[index].setColor(isSelected ? ACCENT : DIM_TEXT);
    }
  }
}
