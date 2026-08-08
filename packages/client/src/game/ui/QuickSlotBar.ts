import Phaser from 'phaser';
import { itemOfSlot } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import { SlotIcon } from '../render/itemSprite';
import {
  ACCENT,
  BAR_BACK,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
  barColor,
} from './theme';

/**
 * 칸 하나의 기준 크기(px). uiScale이 곱해진다.
 *
 * 예전엔 40이었다 — 아이콘이 30px밖에 안 돼서 무엇을 들었는지 구분이 어려웠고,
 * 화면 아래에 있다는 것 외엔 존재감이 없었다. 인벤토리는 전투 중에 곁눈질로 읽는
 * 물건이라 크게 잡는다.
 */
const SLOT_SIZE = 100;
/** 아이콘이 칸을 꽉 채우면 테두리·개수와 겹친다. 양쪽에 여백을 남긴다. */
const ICON_INSET = 20;
const SLOT_GAP = 8;
const SELECTED_STROKE = 0x6fd08c;

/** 드래그로 놓을 대상일 때의 강조색. */
const HOVER_STROKE = 0x6fd08c;

/** 칸 위에 얹히는 체력·스태미나 막대의 높이와 칸과의 간격. */
const BAR_HEIGHT = 24;
const BAR_GAP = 8;

/** 바 아래쪽에 남기는 여백(HudScene이 slotsBottom을 잡을 때 쓰는 값과 같다). */
const BOTTOM_MARGIN = 28;

/**
 * 화면 아래에서 이 바가 예약하는 높이(uiScale 1 기준).
 *
 * **창(Modal)이 이 영역을 침범하면 안 된다** — 창고에서 퀵슬롯으로 끌어다 놓으려면 둘 다
 * 보여야 하기 때문이다. 창의 최대 높이와 창의 세로 위치가 모두 이 한 값에서 나온다.
 * 두 곳에서 따로 계산했더니 창이 막대를 12px 덮었다.
 */
export const BOTTOM_BAR_RESERVED = SLOT_SIZE + BAR_HEIGHT + BAR_GAP + BOTTOM_MARGIN;
const STAMINA_COLOR = 0x6f9fd0;

/**
 * 화면 하단 중앙의 조작 바 — **직업/스탯 버튼 + 퀵슬롯 4칸**, 그 위에 체력·스태미나 막대.
 *
 * 상태는 전부 스냅샷에서 온다 — 이 컴포넌트는 아무것도 기억하지 않는다.
 * 키를 눌러도 여기가 먼저 바뀌지 않고, 서버가 인정한 뒤에야 반영된다.
 *
 * 막대를 여기에 둔 이유: 체력과 스태미나는 "지금 내 몸 상태"라 손에 든 것과 한 덩어리로
 * 읽혀야 한다. 예전엔 얇은 체력 바가 칸 위에 따로 떠 있어서 시선이 두 번 갔다.
 *
 * 칸은 창고 탭과 **같은 드래그 공간**에 등록된다(SlotDrag) — 창고에서 집은 것을
 * 여기에 바로 놓을 수 있어야 하기 때문이다. 그래서 칸에 setInteractive를 걸어둔다.
 */
export class QuickSlotBar {
  /** 직업/스탯 창을 여는 버튼. HudScene이 콜백을 채운다. */
  onProfile: () => void = () => {};

  private readonly boxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly keyLabels: Phaser.GameObjects.Text[] = [];
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private readonly countLabels: Phaser.GameObjects.Text[] = [];
  /** 칸마다 하나씩. 아이콘이 있으면 이름 라벨 대신 아이콘을 보여준다. */
  private readonly icons: SlotIcon[] = [];

  private readonly profileBox: Phaser.GameObjects.Rectangle;
  private readonly profileLabel: Phaser.GameObjects.Text;

  private readonly hpBack: Phaser.GameObjects.Rectangle;
  private readonly hpFill: Phaser.GameObjects.Rectangle;
  private readonly hpLabel: Phaser.GameObjects.Text;
  private readonly staminaBack: Phaser.GameObjects.Rectangle;
  private readonly staminaFill: Phaser.GameObjects.Rectangle;
  private readonly staminaLabel: Phaser.GameObjects.Text;

  /** 레이아웃 후 실제 높이(px). 다른 요소를 이 위에 얹을 때 쓴다. */
  height = 0;
  /** 막대 줄의 오른쪽 끝과 윗변(화면 좌표). 탄약 표시처럼 이 위에 붙는 것들이 쓴다. */
  barsRight = 0;
  barsTop = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly slotCount: number,
  ) {
    // 직업/스탯 버튼 — 칸과 같은 크기라 한 줄로 이어져 보인다.
    this.profileBox = scene.add
      .rectangle(0, 0, SLOT_SIZE, SLOT_SIZE, PANEL_FILL, 0.86)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE)
      .setInteractive({ useHandCursor: true });
    this.profileBox.on('pointerover', () => this.profileBox.setStrokeStyle(2, SELECTED_STROKE));
    this.profileBox.on('pointerout', () => this.profileBox.setStrokeStyle(1, PANEL_STROKE));
    this.profileBox.on('pointerdown', () => this.onProfile());
    this.profileLabel = scene.add
      .text(0, 0, '직업/스탯', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
        align: 'center',
      })
      .setOrigin(0.5, 0.5);

    // 막대 둘. 체력은 왼쪽 절반, 스태미나는 오른쪽 절반을 덮는다(와이어프레임).
    this.hpBack = scene.add.rectangle(0, 0, 10, BAR_HEIGHT, BAR_BACK).setOrigin(0, 0);
    this.hpFill = scene.add.rectangle(0, 0, 10, BAR_HEIGHT, 0x6fd08c).setOrigin(0, 0);
    this.hpLabel = scene.add
      .text(0, 0, '체력', { fontFamily: FONT_SMALL, fontSize: `${SIZE_SMALL}px`, color: DIM_TEXT })
      .setOrigin(0.5, 0.5);
    this.staminaBack = scene.add.rectangle(0, 0, 10, BAR_HEIGHT, BAR_BACK).setOrigin(0, 0);
    this.staminaFill = scene.add
      .rectangle(0, 0, 10, BAR_HEIGHT, STAMINA_COLOR)
      .setOrigin(0, 0);
    this.staminaLabel = scene.add
      .text(0, 0, '스태미나', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
      })
      .setOrigin(0.5, 0.5);

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
    const barHeight = BAR_HEIGHT * scale;
    const barGap = BAR_GAP * scale;
    this.height = size + barHeight + barGap;

    // 직업 버튼까지 한 줄이다 — 가운데 정렬도 그 폭 전체를 기준으로 한다.
    const cells = this.slotCount + 1;
    const totalWidth = size * cells + gap * (cells - 1);
    const startX = centerX - totalWidth / 2;
    const top = bottom - size;

    this.profileBox.setSize(size, size).setPosition(startX, top);
    this.profileBox.input?.hitArea?.setSize(size, size);
    this.profileLabel
      .setFontSize(SIZE_BODY * scale)
      .setWordWrapWidth(size - 12 * scale)
      .setPosition(startX + size / 2, top + size / 2);

    const slotsX = startX + size + gap;
    for (let index = 0; index < this.slotCount; index += 1) {
      const x = slotsX + index * (size + gap);
      const box = this.boxes[index];
      box.setSize(size, size).setPosition(x, top);
      // setSize는 히트 영역을 갱신하지 않는다 — UI 배율이 바뀌면 클릭 판정이 어긋난다.
      box.input?.hitArea?.setSize(size, size);
      this.keyLabels[index]
        .setFontSize(SIZE_SMALL * scale)
        .setPosition(x + 5 * scale, top + 4 * scale);
      this.nameLabels[index].setFontSize(SIZE_BODY * scale).setPosition(x + size / 2, top + size / 2);
      this.icons[index].place(x + size / 2, top + size / 2, size - ICON_INSET * scale);
      this.countLabels[index]
        .setFontSize(SIZE_SMALL * scale)
        .setPosition(x + size - 5 * scale, top + size - 4 * scale);
    }

    // 막대는 **줄 전체**(직업 버튼 포함)를 반씩 나눠 덮는다. 슬롯 위에만 얹으면 왼쪽
    // 버튼 위가 비어서 줄이 두 조각으로 끊겨 보인다 — 체력·스태미나는 특정 칸에
    // 딸린 값이 아니라 "내 몸 상태"라 줄 전체를 덮는 게 맞다.
    const barWidth = (totalWidth - gap) / 2;
    const barTop = top - barGap - barHeight;
    this.barsTop = barTop;
    this.barsRight = startX + totalWidth;

    this.hpBack.setSize(barWidth, barHeight).setPosition(startX, barTop);
    this.hpFill.setSize(barWidth, barHeight).setPosition(startX, barTop);
    this.hpLabel.setFontSize(SIZE_SMALL * scale).setPosition(startX + barWidth / 2, barTop + barHeight / 2);

    const staminaX = startX + barWidth + gap;
    this.staminaBack.setSize(barWidth, barHeight).setPosition(staminaX, barTop);
    this.staminaFill.setSize(barWidth, barHeight).setPosition(staminaX, barTop);
    this.staminaLabel
      .setFontSize(SIZE_SMALL * scale)
      .setPosition(staminaX + barWidth / 2, barTop + barHeight / 2);
    this.barWidth = barWidth;
  }

  /** 마지막 레이아웃의 막대 한 개 폭. 채움 비율을 여기에 곱한다. */
  private barWidth = 0;

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

    // 최대치는 직업·음식으로 달라지므로 서버가 내려준 값을 그대로 쓴다.
    const hpRatio = me && me.maxHp > 0 ? Math.min(1, Math.max(0, me.hp) / me.maxHp) : 0;
    this.hpFill.width = this.barWidth * hpRatio;
    this.hpFill.fillColor = barColor(hpRatio);
    this.hpLabel.setText(me ? `체력 ${Math.ceil(Math.max(0, me.hp))} / ${Math.round(me.maxHp)}` : '체력');

    const staminaRatio =
      me && me.maxStamina > 0 ? Math.min(1, Math.max(0, me.stamina) / me.maxStamina) : 0;
    this.staminaFill.width = this.barWidth * staminaRatio;
    this.staminaLabel.setText(
      me ? `스태미나 ${Math.ceil(Math.max(0, me.stamina))} / ${Math.round(me.maxStamina)}` : '스태미나',
    );
  }
}
