import Phaser from 'phaser';
import { chargingData, itemOfSlot, type InventorySlot } from '@dropfall/shared';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';
import {
  ACCENT,
  BODY_TEXT,
  DIM_TEXT,
  FONT,
  FONT_SMALL,
  PANEL_STROKE,
  SIZE_BODY,
  SIZE_SMALL,
} from './theme';

const SECTION_PAD = 14;
const SECTION_GAP = 12;

/** 게이지 한 줄의 높이와 간격. 라벨·막대·숫자가 한 줄에 들어간다. */
const GAUGE_HEIGHT = 18;
const GAUGE_ROW = 40;
const LABEL_WIDTH = 56;
const VALUE_WIDTH = 96;

/** 강화 버튼은 이 탭에서 제일 큰 물건이다 — 여기서 할 "그 일"이라 눈에 먼저 들어와야 한다. */
const UPGRADE_HEIGHT = 52;

const CHARGE_CELL = 62;
const CHARGE_GAP = 10;
const ICON_INSET = 12;

/** 게이지 색 — 체력(붉음)·자원(초록)·에너지(청록)를 성격대로 나눈다. */
const HP_COLOR = 0xd9756b;
const RESOURCE_COLOR = 0x6fd08c;
const ENERGY_COLOR = 0x5cc6e8;
const GAUGE_BACK = 0x14161d;

const SELECTED_STROKE = 0x6fd08c;
/** 거절 신호: 붉은 테두리가 몇 번, 얼마 간격으로 깜빡이는지. */
const REJECT_STROKE = 0xd9756b;
const REJECT_BLINKS = 3;
const REJECT_BLINK_MS = 110;

export interface ChargeCellHandle {
  index: number;
  box: Phaser.GameObjects.Rectangle;
}

/** 한 줄짜리 게이지. 라벨 · 막대 · "현재 / 최대" 숫자. */
class Gauge {
  private readonly fill: Phaser.GameObjects.Rectangle;
  private readonly value: Phaser.GameObjects.Text;

  constructor(
    builder: PanelBuilder,
    x: number,
    y: number,
    width: number,
    label: string,
    color: number,
  ) {
    const scene = builder.scene;
    const barX = x + LABEL_WIDTH;
    const barWidth = width - LABEL_WIDTH - VALUE_WIDTH;

    const labelText = scene.add
      .text(x, y + GAUGE_HEIGHT / 2, label, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: DIM_TEXT,
      })
      .setOrigin(0, 0.5);
    const back = scene.add
      .rectangle(barX, y, barWidth, GAUGE_HEIGHT, GAUGE_BACK, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    this.fill = scene.add.rectangle(barX + 1, y + 1, 0, GAUGE_HEIGHT - 2, color, 1).setOrigin(0, 0);
    this.value = scene.add
      .text(x + width, y + GAUGE_HEIGHT / 2, '0 / 0', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        color: BODY_TEXT,
      })
      .setOrigin(1, 0.5);

    builder.add(labelText);
    builder.add(back);
    builder.add(this.fill);
    builder.add(this.value);
    this.maxWidth = barWidth - 2;
  }

  private readonly maxWidth: number;

  set(current: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    // 0이 아닌데 막대가 아예 안 보이면 "비었다"로 오해한다 — 최소 1px은 남긴다.
    this.fill.setSize(ratio > 0 ? Math.max(1, this.maxWidth * ratio) : 0, GAUGE_HEIGHT - 2);
    this.value.setText(`${Math.round(current)} / ${Math.round(max)}`);
  }
}

/**
 * 코어 탭 — 코어의 상태(게이지 셋)와 코어에 하는 일(강화·충전)이 한 화면에 있다.
 *
 * 예전에는 이 탭이 "가격/자원/에너지" 세 줄과 아직 아무 일도 안 하는 버튼 둘이었고,
 * 실제 강화는 별도 창(UpgradeModal)에서 했다. 코어 앞에서 하는 일이 두 창에 나뉘어
 * 있으면 "얼마 모였나"를 보고 "올릴까"를 정하는 사이에 창을 갈아타야 한다.
 *
 * 충전 슬롯이 같은 탭 아래쪽에 있는 것도 같은 이유다 — 게이지가 얼마나 찼는지 보면서
 * 무엇을 더 태울지 정하는 게 한 동작이다.
 */
export class CorePanel {
  onUpgrade: () => void = () => {};

  private readonly hpGauge: Gauge;
  private readonly resourceGauge: Gauge;
  private readonly energyGauge: Gauge;
  private readonly upgradeLabel: Phaser.GameObjects.Text;
  private readonly upgradeBox: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  private readonly commentaryText: Phaser.GameObjects.Text;

  private readonly cells: ChargeCellHandle[] = [];
  private readonly icons: SlotIcon[] = [];
  private readonly counts: Phaser.GameObjects.Text[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  /** 지금 열려 있는 칸 수(코어 티어). */
  private openCount = 0;
  /** 거절 깜빡임이 도는 중인 칸. 그동안은 스냅샷이 테두리를 덮어쓰지 않는다. */
  private readonly rejecting = new Set<number>();

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;
    // --- 게이지 -----------------------------------------------------------
    const gaugeHeight = SECTION_PAD * 2 + 16 + GAUGE_ROW * 3;
    builder.addSection(0, 0, builder.width, gaugeHeight);
    builder.addSectionTitle(SECTION_PAD, SECTION_PAD, '코어 상태');

    const gaugeTop = SECTION_PAD + 20;
    const gaugeWidth = builder.width - SECTION_PAD * 2;
    this.hpGauge = new Gauge(builder, SECTION_PAD, gaugeTop, gaugeWidth, '체력', HP_COLOR);
    this.resourceGauge = new Gauge(
      builder,
      SECTION_PAD,
      gaugeTop + GAUGE_ROW,
      gaugeWidth,
      '자원',
      RESOURCE_COLOR,
    );
    this.energyGauge = new Gauge(
      builder,
      SECTION_PAD,
      gaugeTop + GAUGE_ROW * 2,
      gaugeWidth,
      '에너지',
      ENERGY_COLOR,
    );

    // --- 강화 -------------------------------------------------------------
    const upgradeY = gaugeHeight + SECTION_GAP;
    this.upgradeBox = builder.addButton(
      SECTION_PAD,
      upgradeY,
      builder.width - SECTION_PAD * 2,
      UPGRADE_HEIGHT,
      '',
      () => this.onUpgrade(),
    );
    this.upgradeLabel = scene.add
      .text(builder.width / 2, upgradeY + UPGRADE_HEIGHT / 2, '코어 강화', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY + 4}px`,
        color: BODY_TEXT,
      })
      .setOrigin(0.5, 0.5);
    builder.add(this.upgradeLabel);

    // --- 충전 -------------------------------------------------------------
    const chargeY = upgradeY + UPGRADE_HEIGHT + SECTION_GAP;
    const chargeHeight = SECTION_PAD * 2 + 20 + CHARGE_CELL;
    builder.addSection(0, chargeY, builder.width, chargeHeight);
    builder.addSectionTitle(
      SECTION_PAD,
      chargeY + SECTION_PAD,
      '코어 충전  (나무·돌 → 자원 / 몬스터 드랍 → 에너지)',
    );

    const gridWidth = chargingData.slotCount * CHARGE_CELL + (chargingData.slotCount - 1) * CHARGE_GAP;
    const gridX = Math.round((builder.width - gridWidth) / 2);
    const cellY = chargeY + SECTION_PAD + 22;
    for (let index = 0; index < chargingData.slotCount; index += 1) {
      const x = gridX + index * (CHARGE_CELL + CHARGE_GAP);
      const box = scene.add
        .rectangle(x, cellY, CHARGE_CELL, CHARGE_CELL, GAUGE_BACK, 0.9)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        // 넣는 것뿐 아니라 **도로 빼는 것**도 드래그다 — 그러려면 칸이 interactive여야 한다.
        .setInteractive({ useHandCursor: true });
      const icon = new SlotIcon(scene, CHARGE_CELL - ICON_INSET * 2);
      icon.place(x + CHARGE_CELL / 2, cellY + CHARGE_CELL / 2 - 4, CHARGE_CELL - ICON_INSET * 2);
      const count = scene.add
        .text(x + CHARGE_CELL - 4, cellY + CHARGE_CELL - 3, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
        })
        .setOrigin(1, 1);
      const label = scene.add
        .text(x + CHARGE_CELL / 2, cellY + CHARGE_CELL / 2, '비었음', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        })
        .setOrigin(0.5, 0.5);

      builder.add(box);
      if (icon.object) builder.add(icon.object);
      builder.add(count);
      builder.add(label);

      this.cells.push({ index, box });
      this.icons.push(icon);
      this.counts.push(count);
      this.labels.push(label);
    }

    // --- 코어 AI 대사 ------------------------------------------------------
    const commentaryY = chargeY + chargeHeight + SECTION_GAP;
    this.commentaryText = scene.add
      .text(SECTION_PAD, commentaryY, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: ACCENT,
        wordWrap: { width: builder.width - SECTION_PAD * 2 },
      })
      .setOrigin(0, 0);
    builder.add(this.commentaryText);
  }

  setStatus(status: {
    coreHp: number;
    coreMaxHp: number;
    coreResource: number;
    coreMaxResource: number;
    coreEnergy: number;
    coreMaxEnergy: number;
    upgradeAvailable: boolean;
    upgradeResourceCost: number;
    upgradeEnergyCost: number;
  }): void {
    this.hpGauge.set(status.coreHp, status.coreMaxHp);
    this.resourceGauge.set(status.coreResource, status.coreMaxResource);
    this.energyGauge.set(status.coreEnergy, status.coreMaxEnergy);

    if (!status.upgradeAvailable) {
      this.upgradeLabel.setText('최고 단계').setColor(DIM_TEXT);
      this.upgradeBox.disableInteractive();
      return;
    }

    // 모자란 쪽을 색으로 알린다 — 비용만 적어 두면 눌러 보고 나서야 안 된다는 걸 안다.
    const affordable =
      status.coreResource >= status.upgradeResourceCost &&
      status.coreEnergy >= status.upgradeEnergyCost;
    this.upgradeLabel
      .setText(`코어 강화   자원 ${status.upgradeResourceCost} · 에너지 ${status.upgradeEnergyCost}`)
      .setColor(affordable ? BODY_TEXT : DIM_TEXT);
    this.upgradeBox.setInteractive({ useHandCursor: true });
  }

  /**
   * @param openCount 코어 티어만큼 열려 있는 칸 수. 그 뒤 칸은 잠겨 있다 —
   *   지우지 않고 흐리게 남겨서 "강화하면 늘어난다"를 계속 보여준다.
   */
  setChargeSlots(slots: (InventorySlot | null)[], openCount: number): void {
    this.openCount = openCount;
    this.cells.forEach((cell, index) => {
      const locked = index >= openCount;
      const slot = locked ? null : (slots[index] ?? null);
      const item = itemOfSlot(slot);

      this.icons[index]?.setItem(slot?.itemId ?? null);
      this.counts[index]?.setText(slot && slot.count > 1 ? String(slot.count) : '');
      this.labels[index]?.setText(locked ? '잠김' : item ? '' : '비었음');
      cell.box.setAlpha(locked ? 0.35 : 1);
      // 거절 깜빡임 중에는 테두리를 건드리지 않는다 — 다음 스냅샷이 바로 덮어쓴다.
      if (this.rejecting.has(index)) return;
      cell.box.setStrokeStyle(1, item ? SELECTED_STROKE : PANEL_STROKE);
    });
  }

  /** 이 칸이 지금 아이템을 받을 수 있는가(티어로 열려 있는가). */
  isChargeSlotOpen(index: number): boolean {
    return index < this.openCount;
  }

  /**
   * 받을 수 없는 물건을 넣으려 했을 때 붉게 깜빡인다.
   *
   * 서버에 보내 보고 거절당하길 기다리지 않는다 — 아무 일도 안 일어나는 것과
   * 거절당한 것을 화면에서 구분할 수 없기 때문이다. 판정은 서버와 같은 규칙
   * (World.canCharge)이라 어긋나지 않는다.
   */
  rejectCharge(index: number): void {
    const cell = this.cells[index];
    if (!cell || this.rejecting.has(index)) return;
    this.rejecting.add(index);

    let remaining = REJECT_BLINKS * 2;
    const blink = () => {
      remaining -= 1;
      cell.box.setStrokeStyle(1, remaining % 2 === 1 ? REJECT_STROKE : PANEL_STROKE);
      if (remaining > 0) {
        this.builder.scene.time.delayedCall(REJECT_BLINK_MS, blink);
      } else {
        this.rejecting.delete(index);
      }
    };
    blink();
  }

  setCommentary(text: string): void {
    this.commentaryText.setText(`"${text}"`);
  }

  /** 충전 칸 손잡이. SlotDrag가 드래그앤드롭 대상으로 등록한다. */
  get chargeCells(): readonly ChargeCellHandle[] {
    return this.cells;
  }
}
