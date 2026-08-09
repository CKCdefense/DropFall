import Phaser from 'phaser';
import {
  chargingData,
  coreUpgradesData,
  itemOfSlot,
  reviveData,
  type InventorySlot,
} from '@dropfall/shared';
import type { PanelBuilder } from './Modal';
import { SlotIcon } from '../render/itemSprite';
import { CostTag } from './costTag';
import {
  BAR_LARGE,
  HUD_ATLAS,
  HUD_BAR_SCALE,
  HudBar,
  ICON_ENERGY,
  ICON_ORB,
  ICON_RESOURCE,
} from './hudBar';
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

const GAP = 12;

/** ACCENT('#6fd08c')의 숫자판. 홀로그램 테두리와 고른 칸 강조에 쓴다. */
const ACCENT_STROKE = 0x6fd08c;
/** 홀로그램 판 — 상단 탭의 선택된 모습과 같은 값(Modal.BOARD_FILL). */
const HOLO_FILL = 0x0f1117;
const LACKING_TEXT = '#d98a8a';

/**
 * 게이지 한 줄 — [아이콘] [이름 / 값] 위에 [픽셀 게이지].
 *
 * 숫자만 적힌 단색 막대였던 것을 HUD와 **같은 물건**으로 바꾼다. 화면 왼쪽 위 코어
 * 패널이 이미 이 그림과 이 게이지를 쓰고 있어서, 창을 열었을 때 다른 물건처럼 보이면
 * 같은 값이라는 게 안 읽힌다.
 *
 * 아이콘에 상자를 두르지 않는다 — 그림 자체가 이미 1px 외곽선을 두르고 있어서
 * 상자를 씌우면 테두리가 두 겹이 되고, 그만큼 게이지에 줄 폭도 줄어든다.
 */
const GAUGE_ROW = 50;
const GAUGE_ROW_GAP = 6;
/** 아이콘 원본은 12px — 정수배로만 키운다(36px). */
const GAUGE_ICON_SCALE = 3;
const GAUGE_ICON_SIZE = 12 * GAUGE_ICON_SCALE;
const GAUGE_BAR_TOP = 16;

const CHARGE_CELL = 110;
const CHARGE_GAP = 20;
const CHARGE_ICON_INSET = 24;

/** 유령 부활 칸 — 최대 인원(4) - 나 = 팀원 3명분. */
const GHOST_SLOTS = 3;
/**
 * 제목 줄. 픽셀 폰트는 정수배에서만 선명해서 11px 다음 칸이 곧 22px이다 —
 * "코어 현황"과 같은 크기가 되면서 이 창의 두 머리글이 한 규격으로 맞는다.
 */
const GHOST_TITLE_SIZE = SIZE_BODY * 2;
const GHOST_TITLE_GAP = GHOST_TITLE_SIZE + 12;
const GHOST_GAP = 10;
/** 칸 하나에 22px 글자로 들어가는 글자 수. 넘치면 옆 칸을 침범한다. */
const GHOST_NAME_CHARS = 7;

/** 넘치는 이름을 잘라 말줄임표를 붙인다. */
function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * 맨 위 머리글.
 *
 * 게이지 셋만 덩그러니 있으면 무엇의 체력·자원인지가 탭 이름(코어)에만 걸린다 —
 * 탭은 위에 있고 게이지는 아래에 있어서 눈이 그 둘을 잇지 못했다. 상점의 "오늘의
 * 진열"과 같은 규격(11px의 정수배 굵은 자체)으로 세운다.
 */
const HEAD_FONT_SIZE = SIZE_BODY * 2;
const HEAD_HEIGHT = HEAD_FONT_SIZE + 12;

/**
 * 맨 아래 강화 · 수리 버튼.
 *
 * 이 탭에서 **누르는 것은 이 둘뿐**이라 판 맨 아래에 좌우로 크게 깔아 둔다 — 위쪽은
 * 전부 상태를 보는 자리다. 제목을 가운데 크게 놓고 필요 자원은 그 아래 한 줄로 판
 * 안에 담는다: 비용이 버튼 밖에 있으면 "이 값을 내면 이게 눌린다"가 안 묶인다.
 */
const ACTION_HEIGHT = 72;
const ACTION_GAP = 12;
const ACTION_TITLE_Y = 22;
const ACTION_COST_Y = 50;
/** 비용 두 개 사이. 한 버튼 안의 값이라 붙여 둬야 한 덩어리로 읽힌다. */
const ACTION_COST_GAP = 14;


/** 게이지 색 — 체력(붉음)·자원(초록)·에너지(청록)를 성격대로 나눈다. */
const HP_COLOR = 0xd9756b;
const RESOURCE_COLOR = 0x6fd08c;
const ENERGY_COLOR = 0x5cc6e8;

/** 거절 신호: 붉은 테두리가 몇 번, 얼마 간격으로 깜빡이는지. */
const REJECT_STROKE = 0xd9756b;
const REJECT_BLINKS = 3;
const REJECT_BLINK_MS = 110;

export interface ChargeCellHandle {
  index: number;
  box: Phaser.GameObjects.Rectangle;
}

/**
 * 게이지 한 줄. 왼쪽 아이콘 상자 + 이름/값 글줄 + 그 아래 픽셀 게이지.
 *
 * 값을 막대 **오른쪽 끝**이 아니라 이름과 같은 줄에 두는 이유: 막대가 길어야 잔량이
 * 눈에 들어오는데, 오른쪽에 숫자 자리를 떼어 주면 막대가 그만큼 짧아진다.
 */
class Gauge {
  private readonly bar: HudBar;
  private readonly value: Phaser.GameObjects.Text;
  private readonly scale = HUD_BAR_SCALE;

  constructor(
    builder: PanelBuilder,
    x: number,
    y: number,
    width: number,
    label: string,
    iconFrame: string,
    private readonly color: number,
  ) {
    const scene = builder.scene;

    const texture = scene.textures.exists(HUD_ATLAS) ? scene.textures.get(HUD_ATLAS) : null;
    if (texture?.has(iconFrame)) {
      const icon = scene.add
        .image(x + GAUGE_ICON_SIZE / 2, y + GAUGE_ROW / 2, HUD_ATLAS, iconFrame)
        .setScale(GAUGE_ICON_SCALE);
      builder.add(icon);
    }

    const barX = x + GAUGE_ICON_SIZE + GAP;
    const barWidth = width - GAUGE_ICON_SIZE - GAP;

    const labelText = scene.add.text(barX, y, label, {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      fontStyle: 'bold',
      color: DIM_TEXT,
    });
    builder.add(labelText);

    this.value = scene.add
      .text(x + width, y, '0 / 0', {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        color: BODY_TEXT,
      })
      .setOrigin(1, 0);
    builder.add(this.value);

    // 게이지는 scene에 붙어 생기므로 창 컨테이너로 옮겨야 창을 끌 때 따라온다.
    // 굵은 규격(BAR_LARGE, 화면 32px)을 쓴다 — 코어의 세 값은 곁눈질이 아니라
    // 이 창을 연 목적 자체라 얇은 줄로 깔 이유가 없다.
    this.bar = new HudBar(scene, BAR_LARGE);
    this.bar.attach((object) => builder.add(object));
    this.bar.layout(barX, y + GAUGE_BAR_TOP, barWidth, this.scale);
  }

  set(current: number, max: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    this.bar.setValue(ratio, this.color, this.scale);
    this.value.setText(`${Math.round(current)} / ${Math.round(max)}`);
  }
}

/**
 * 코어 탭 — 코어의 상태(게이지 셋)와 코어에 하는 일(강화·수리·충전·부활)이 한 화면에.
 *
 * **구역 상자를 최소로 쓴다.** 게이지 셋은 아이콘 상자와 게이지 자체가 이미 테두리라
 * 바깥을 또 감싸면 테두리가 겹치고, 강화·수리는 누르는 물건이라 다른 탭의 버튼과 같은
 * 홀로그램 판이면 그것으로 경계가 선다. 이 탭에는 구역 상자가 하나도 없다.
 *
 * 값의 단위는 글자가 아니라 **그림**이다(CostTag) — 강화 비용도, 부활 비용도 화면 왼쪽
 * 위 코어 패널이 쓰는 것과 같은 자원·에너지 아이콘으로 말한다.
 */
export class CorePanel {
  onUpgrade: () => void = () => {};
  onRepair: () => void = () => {};
  onReviveGhost: (targetId: string) => void = () => {};

  private readonly hpGauge: Gauge;
  private readonly resourceGauge: Gauge;
  private readonly energyGauge: Gauge;

  private readonly upgradeBox: Phaser.GameObjects.Rectangle;
  private readonly upgradeLabel: Phaser.GameObjects.Text;
  private readonly upgradeResource: CostTag;
  private readonly upgradeEnergy: CostTag;
  private readonly repairBox: Phaser.GameObjects.Rectangle;
  private readonly repairLabel: Phaser.GameObjects.Text;
  private readonly repairResource: CostTag;

  private readonly cells: ChargeCellHandle[] = [];
  private readonly icons: SlotIcon[] = [];
  private readonly counts: Phaser.GameObjects.Text[] = [];
  private readonly labels: Phaser.GameObjects.Text[] = [];
  /** 지금 열려 있는 칸 수(코어 티어). */
  private openCount = 0;
  /** 거절 깜빡임이 도는 중인 칸. 그동안은 스냅샷이 테두리를 덮어쓰지 않는다. */
  private readonly rejecting = new Set<number>();

  /** 유령 부활 칸. targetId가 null이면 그 자리에 유령이 없다(비어 있음/락 표시). */
  private readonly ghostCells: {
    box: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    targetId: string | null;
  }[] = [];

  constructor(private readonly builder: PanelBuilder) {
    const scene = builder.scene;

    // --- 위: 머리글 + 게이지 셋. 판 폭을 통째로 쓴다 — 잔량은 막대가 길수록 잘 읽힌다.
    const head = scene.add.text(0, 0, '코어 현황', {
      fontFamily: FONT,
      fontSize: `${HEAD_FONT_SIZE}px`,
      fontStyle: 'bold',
      color: BODY_TEXT,
    });
    builder.add(head);

    const gaugeTop = HEAD_HEIGHT;
    const topHeight = gaugeTop + GAUGE_ROW * 3 + GAUGE_ROW_GAP * 2;
    const gaugeWidth = builder.width;

    this.hpGauge = new Gauge(builder, 0, gaugeTop, gaugeWidth, '체력', ICON_ORB, HP_COLOR);
    this.resourceGauge = new Gauge(
      builder,
      0,
      gaugeTop + GAUGE_ROW + GAUGE_ROW_GAP,
      gaugeWidth,
      '자원',
      ICON_RESOURCE,
      RESOURCE_COLOR,
    );
    this.energyGauge = new Gauge(
      builder,
      0,
      gaugeTop + (GAUGE_ROW + GAUGE_ROW_GAP) * 2,
      gaugeWidth,
      '에너지',
      ICON_ENERGY,
      ENERGY_COLOR,
    );

    // --- 가운데: 충전 칸 ----------------------------------------------------
    // 제목을 달지 않는다 — 무엇을 넣는 자리인지는 넣어 보면 알고(못 넣는 것은 붉게
    // 깜빡인다), 규칙은 가이드 창이 그림으로 설명한다.
    const chargeY = topHeight + GAP;
    const gridWidth =
      chargingData.slotCount * CHARGE_CELL + (chargingData.slotCount - 1) * CHARGE_GAP;
    const gridX = Math.round((builder.width - gridWidth) / 2);

    for (let index = 0; index < chargingData.slotCount; index += 1) {
      const x = gridX + index * (CHARGE_CELL + CHARGE_GAP);
      const box = scene.add
        .rectangle(x, chargeY, CHARGE_CELL, CHARGE_CELL, PANEL_FILL, 0.9)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        // 넣는 것뿐 아니라 **도로 빼는 것**도 드래그다 — 그러려면 칸이 interactive여야 한다.
        .setInteractive({ useHandCursor: true });
      const iconSize = CHARGE_CELL - CHARGE_ICON_INSET * 2;
      const icon = new SlotIcon(scene, iconSize);
      icon.place(x + CHARGE_CELL / 2, chargeY + CHARGE_CELL / 2, iconSize);
      const count = scene.add
        .text(x + CHARGE_CELL - 6, chargeY + CHARGE_CELL - 5, '', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
          fontStyle: 'bold',
          color: BODY_TEXT,
        })
        .setOrigin(1, 1);
      const label = scene.add
        .text(x + CHARGE_CELL / 2, chargeY + CHARGE_CELL / 2, '비었음', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY}px`,
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

    // --- 유령 부활 -----------------------------------------------------------
    // 낮에만, 팀원이 자원을 치르고 되살린다(World.reviveGhostAtCore). 유령이 없으면
    // 세 칸 다 빈 채로 흐리게 남는다 — 강화·충전처럼 "지금은 못 하는" 상태도 항상 보인다.
    //
    // 구역 상자를 씌우지 않는다. 칸 셋이 이미 홀로그램 테두리를 두르고 있어 상자를
    // 두르면 테두리가 겹치고, 이 탭에서 상자를 쓰는 곳이 여기 하나뿐이라 혼자 튄다.
    const actionY = builder.height - ACTION_HEIGHT;
    const reviveY = chargeY + CHARGE_CELL + GAP;

    const title = scene.add.text(0, reviveY, '유령 부활', {
      fontFamily: FONT,
      fontSize: `${GHOST_TITLE_SIZE}px`,
      fontStyle: 'bold',
      color: BODY_TEXT,
    });
    builder.add(title);
    // 비용은 제목보다 한 단 작게 두되 **줄 가운데**에 맞춘다 — 위쪽에 붙으면 제목이
    // 커진 만큼 따로 떠 보인다.
    const reviveCost = new CostTag(builder, ICON_RESOURCE);
    reviveCost.setValue(`${reviveData.coreReviveResource}`, DIM_TEXT);
    reviveCost.place(Math.ceil(title.width) + GAP, reviveY + GHOST_TITLE_SIZE / 2);

    // 칸 높이는 남는 자리를 그대로 쓴다 — 아래 강화·수리 버튼과 같은 덩치가 되어
    // "누를 수 있는 것"끼리 크기가 맞는다.
    const ghostRowY = reviveY + GHOST_TITLE_GAP;
    const ghostHeight = actionY - GAP - ghostRowY;
    const ghostWidth = (builder.width - GHOST_GAP * (GHOST_SLOTS - 1)) / GHOST_SLOTS;
    for (let index = 0; index < GHOST_SLOTS; index += 1) {
      const x = index * (ghostWidth + GHOST_GAP);
      const box = this.holoBox(x, ghostRowY, ghostWidth, ghostHeight, () => {
        const targetId = this.ghostCells[index]?.targetId;
        if (targetId) this.onReviveGhost(targetId);
      });
      box.disableInteractive();
      const label = scene.add
        .text(x + ghostWidth / 2, ghostRowY + ghostHeight / 2, '-', {
          fontFamily: FONT,
          fontSize: `${SIZE_BODY * 2}px`,
          fontStyle: 'bold',
          color: DIM_TEXT,
        })
        .setOrigin(0.5, 0.5);
      builder.add(label);
      this.ghostCells.push({ box, label, targetId: null });
    }

    // --- 맨 아래: 강화 · 수리. 이 탭에서 누르는 것은 이 둘뿐이다. --------------
    const actionWidth = (builder.width - ACTION_GAP) / 2;
    const repairX = actionWidth + ACTION_GAP;

    this.upgradeBox = this.holoBox(0, actionY, actionWidth, ACTION_HEIGHT, () => this.onUpgrade());
    this.upgradeLabel = this.actionTitle(actionWidth / 2, actionY, '코어 강화');
    this.upgradeResource = new CostTag(builder, ICON_RESOURCE);
    this.upgradeEnergy = new CostTag(builder, ICON_ENERGY);

    this.repairBox = this.holoBox(repairX, actionY, actionWidth, ACTION_HEIGHT, () =>
      this.onRepair(),
    );
    this.repairLabel = this.actionTitle(repairX + actionWidth / 2, actionY, '코어 수리');
    this.repairResource = new CostTag(builder, ICON_RESOURCE);

    // 비용표는 값에 따라 폭이 달라져서 setStatus가 다시 놓는다 — 여기서는 어디를
    // 기준으로 가운데를 잡을지만 기억해 둔다.
    this.upgradeCostAt = { x: actionWidth / 2, y: actionY + ACTION_COST_Y };
    this.repairCostAt = { x: repairX + actionWidth / 2, y: actionY + ACTION_COST_Y };
  }

  /** 비용표를 가운데로 놓을 기준점. 값이 바뀔 때마다 폭을 다시 재야 한다. */
  private readonly upgradeCostAt: { x: number; y: number };
  private readonly repairCostAt: { x: number; y: number };

  /**
   * 홀로그램 판 하나 — 어두운 바닥 + 초록 테두리. 다른 탭의 버튼(Modal.addHoloButton)과
   * 같은 재질이지만, 여기 판들은 안에 비용표까지 들어가서 글자 배치를 직접 잡는다.
   */
  private holoBox(
    x: number,
    y: number,
    width: number,
    height: number,
    onClick: () => void,
  ): Phaser.GameObjects.Rectangle {
    const box = this.builder.scene.add
      .rectangle(x, y, width, height, HOLO_FILL, 1)
      .setOrigin(0, 0)
      .setStrokeStyle(1, ACCENT_STROKE)
      .setInteractive({ useHandCursor: true });
    box.on('pointerover', () => box.setFillStyle(PANEL_FILL, 1));
    box.on('pointerout', () => box.setFillStyle(HOLO_FILL, 1));
    box.on('pointerdown', () => onClick());
    this.builder.add(box);
    return box;
  }

  /** 버튼 이름. 판 **가운데에 크게** 놓아야 누르는 물건으로 보인다. */
  private actionTitle(centerX: number, top: number, label: string): Phaser.GameObjects.Text {
    const text = this.builder.scene.add
      .text(centerX, top + ACTION_TITLE_Y, label, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY * 2}px`,
        fontStyle: 'bold',
        color: ACCENT,
      })
      .setOrigin(0.5, 0.5);
    this.builder.add(text);
    return text;
  }

  /**
   * 비용표 한 줄을 버튼 가운데에 놓는다. 두 개면 사이를 좁게 붙여 한 덩어리로 만든다 —
   * 벌려 놓으면 각각 다른 버튼의 값처럼 보인다.
   */
  private placeCosts(at: { x: number; y: number }, tags: CostTag[]): void {
    const total =
      tags.reduce((sum, tag) => sum + tag.width, 0) + ACTION_COST_GAP * (tags.length - 1);
    let x = at.x - total / 2;
    for (const tag of tags) {
      tag.place(x, at.y);
      x += tag.width + ACTION_COST_GAP;
    }
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
      forceSetText(this.upgradeLabel, '최고 단계');
      this.upgradeLabel.setColor(DIM_TEXT);
      this.upgradeResource.setVisible(false);
      this.upgradeEnergy.setVisible(false);
      this.setEnabled(this.upgradeBox, false);
    } else {
      forceSetText(this.upgradeLabel, '코어 강화');
      this.upgradeLabel.setColor(ACCENT);
      // 모자란 쪽을 **줄 단위로** 붉게 물들인다 — 비용만 적어 두면 눌러 보고 나서야
      // 무엇이 모자란지 안다.
      const enoughResource = status.coreResource >= status.upgradeResourceCost;
      const enoughEnergy = status.coreEnergy >= status.upgradeEnergyCost;
      this.upgradeResource.setVisible(true);
      this.upgradeEnergy.setVisible(true);
      this.upgradeResource.setValue(
        `${status.upgradeResourceCost}`,
        enoughResource ? BODY_TEXT : LACKING_TEXT,
      );
      this.upgradeEnergy.setValue(
        `${status.upgradeEnergyCost}`,
        enoughEnergy ? BODY_TEXT : LACKING_TEXT,
      );
      this.placeCosts(this.upgradeCostAt, [this.upgradeResource, this.upgradeEnergy]);
      this.setEnabled(this.upgradeBox, true);
    }

    // 수리는 강화와 달리 "다 못 채워도" 낼 수 있는 만큼은 항상 된다 — 버튼이 막히는
    // 조건은 둘뿐이다: 이미 꽉 찼거나, 자원이 아예 0이거나.
    const missing = status.coreMaxHp - status.coreHp;
    if (missing <= 0) {
      forceSetText(this.repairLabel, '최대치');
      this.repairLabel.setColor(DIM_TEXT);
      this.repairResource.setVisible(false);
      this.setEnabled(this.repairBox, false);
    } else {
      forceSetText(this.repairLabel, '코어 수리');
      this.repairLabel.setColor(ACCENT);
      const fullCost = Math.ceil(missing * coreUpgradesData.repairResourcePerHp);
      const canRepair = status.coreResource > 0;
      this.repairResource.setVisible(true);
      this.repairResource.setValue(
        `${Math.min(fullCost, status.coreResource)} / ${fullCost}`,
        canRepair ? BODY_TEXT : LACKING_TEXT,
      );
      this.placeCosts(this.repairCostAt, [this.repairResource]);
      this.setEnabled(this.repairBox, canRepair);
    }
  }

  /** 못 누르는 판은 흐리게 눕힌다 — 지우면 "여기서 무엇을 할 수 있는가"가 사라진다. */
  private setEnabled(box: Phaser.GameObjects.Rectangle, enabled: boolean): void {
    box.setAlpha(enabled ? 1 : 0.45);
    if (enabled) box.setInteractive({ useHandCursor: true });
    else box.disableInteractive();
  }

  /**
   * 유령이 된 팀원 목록. 최대 {@link GHOST_SLOTS}명분만 칸이 있다(4인방 기준 나를 뺀
   * 나머지 전부) — 그 이상은 방 정원 자체가 안 된다.
   *
   * @param ghosts 유령 상태인 팀원들(나 자신은 넘기지 않는다 — 내가 유령이면 이 창을
   *   열 수 있는 처지가 아니다).
   * @param resource 지금 코어 자원 게이지. 칸마다 되살릴 수 있는지 색으로 알린다.
   */
  setGhosts(ghosts: { id: string; nickname: string }[], resource: number): void {
    const affordable = resource >= reviveData.coreReviveResource;
    this.ghostCells.forEach((cell, index) => {
      const ghost = ghosts[index];
      if (!ghost) {
        cell.targetId = null;
        forceSetText(cell.label, '-');
        cell.label.setColor(DIM_TEXT);
        this.setEnabled(cell.box, false);
        return;
      }
      cell.targetId = ghost.id;
      // 이름은 사람이 정하는 값이라 길이를 못 믿는다 — 칸(172px)에 22px 글자로
      // 들어가는 만큼만 남기고 자른다. 넘치면 옆 칸까지 글자가 삐져나간다.
      forceSetText(cell.label, truncate(ghost.nickname, GHOST_NAME_CHARS));
      cell.label.setColor(affordable ? ACCENT : LACKING_TEXT);
      this.setEnabled(cell.box, affordable);
    });
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
      forceSetText(this.labels[index], locked ? '잠김' : item ? '' : '비었음');
      cell.box.setAlpha(locked ? 0.35 : 1);
      // 거절 깜빡임 중에는 테두리를 건드리지 않는다 — 다음 스냅샷이 바로 덮어쓴다.
      if (this.rejecting.has(index)) return;
      cell.box.setStrokeStyle(1, item ? ACCENT_STROKE : PANEL_STROKE);
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

  /** 충전 칸 손잡이. SlotDrag가 드래그앤드롭 대상으로 등록한다. */
  get chargeCells(): readonly ChargeCellHandle[] {
    return this.cells;
  }
}
