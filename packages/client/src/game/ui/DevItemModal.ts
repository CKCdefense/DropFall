import Phaser from 'phaser';
import { itemsData } from '@dropfall/shared';
import { ACCENT, BODY_TEXT, DIM_TEXT, FONT, FONT_SMALL, PANEL_STROKE, SIZE_BODY, SIZE_SMALL } from './theme';
import { Modal } from './Modal';
import { SlotIcon } from '../render/itemSprite';

/** 종류별로 묶어서 보여준다 — "무기만 훑어보고 싶다"가 가장 흔한 쓰임이다. */
const TABS = [
  { key: 'weapon', label: '무기·도구' },
  { key: 'consumable', label: '소모품' },
  { key: 'material', label: '재료' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const PANEL_WIDTH = 330;
const PANEL_HEIGHT = 320;
const CELL = 44;
const CELL_GAP = 6;
const COLUMNS = 6;
const ROWS = 4;
const PER_PAGE = COLUMNS * ROWS;
const ICON_INSET = 12;
const TAB_HEIGHT = 18;
const GRID_TOP = TAB_HEIGHT + 8;

/**
 * 테스트 모드 — 아이템 도감.
 *
 * 모든 아이템을 실제로 들고 확인하려면 캐고·모으고·만들고·사는 과정을 다 거쳐야 하는데,
 * 스프라이트가 손에 어떻게 붙는지만 보려는 것뿐일 때는 그게 전부 방해다. 여기서는
 * **한 번 눌러 바로 손에 든다**.
 *
 * 콘솔(`give`)과 같은 일을 하지만 입구가 다르다 — id를 외우고 있으면 콘솔이 빠르고,
 * 뭐가 있는지 훑어보려면 그림이 있는 이쪽이 빠르다. 실제 실행은 둘 다 같은 개발
 * 커맨드로 내려간다(규칙이 한 곳에만 있어야 한다).
 */
export class DevItemModal extends Modal {
  /** 개발 커맨드 한 줄을 실행한다. HudScene이 connection에 연결한다. */
  onCommand: (line: string) => void = () => {};

  private readonly cellBoxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly cellIcons: SlotIcon[] = [];
  private readonly cellLabels: Phaser.GameObjects.Text[] = [];
  private readonly tabTexts: Phaser.GameObjects.Text[] = [];
  private readonly pageText: Phaser.GameObjects.Text;
  private readonly detailText: Phaser.GameObjects.Text;

  private tab: TabKey = 'weapon';
  private page = 0;
  /** 지금 탭·페이지에 그려진 아이템 id. 빈 칸은 undefined. */
  private visible: (string | undefined)[] = [];

  constructor(scene: Phaser.Scene) {
    super(scene, { title: '테스트 모드 — 아이템', width: PANEL_WIDTH, height: PANEL_HEIGHT });

    TABS.forEach((tab, index) => {
      const x = index * 78;
      const text = scene.add
        .text(x, 0, tab.label, { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: DIM_TEXT })
        .setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => this.selectTab(tab.key));
      this.addContent(text);
      this.tabTexts.push(text);
    });

    this.pageText = scene.add
      .text(this.contentWidth, 0, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    // 페이지 글자 자체가 넘김 버튼이다 — 좁은 패널에 버튼을 더 두면 칸이 줄어든다.
    this.pageText.on('pointerdown', () => this.turnPage());
    this.addContent(this.pageText);

    for (let index = 0; index < PER_PAGE; index += 1) {
      const x = (index % COLUMNS) * (CELL + CELL_GAP);
      const y = GRID_TOP + Math.floor(index / COLUMNS) * (CELL + CELL_GAP);

      const box = scene.add
        .rectangle(x, y, CELL, CELL, 0x000000, 0.25)
        .setOrigin(0, 0)
        .setStrokeStyle(1, PANEL_STROKE)
        .setInteractive({ useHandCursor: true });
      box.on('pointerover', () => this.showDetail(index));
      box.on('pointerdown', () => this.takeItem(index));
      this.addContent(box);
      this.cellBoxes.push(box);

      const icon = new SlotIcon(scene, CELL - ICON_INSET);
      icon.place(x + CELL / 2, y + CELL / 2 - 3, CELL - ICON_INSET);
      if (icon.object) this.addContent(icon.object);
      this.cellIcons.push(icon);

      const label = scene.add
        .text(x + CELL / 2, y + CELL - 2, '', {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: DIM_TEXT,
        })
        .setOrigin(0.5, 1);
      this.addContent(label);
      this.cellLabels.push(label);
    }

    this.detailText = scene.add.text(0, GRID_TOP + ROWS * (CELL + CELL_GAP) + 4, '', {
      fontFamily: FONT,
      fontSize: `${SIZE_BODY}px`,
      color: BODY_TEXT,
    });
    this.addContent(this.detailText);

    this.addContent(
      scene.add.text(0, PANEL_HEIGHT - 62, '칸을 누르면 손에 든다 · Shift+클릭이면 10개', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: DIM_TEXT,
      }),
    );

    this.selectTab('weapon');
  }

  private itemsOfTab(): string[] {
    return Object.keys(itemsData).filter((itemId) => itemsData[itemId]!.kind === this.tab);
  }

  private selectTab(tab: TabKey): void {
    this.tab = tab;
    this.page = 0;
    this.tabTexts.forEach((text, index) =>
      text.setColor(TABS[index]!.key === tab ? ACCENT : DIM_TEXT),
    );
    this.refresh();
  }

  private turnPage(): void {
    const pages = Math.max(1, Math.ceil(this.itemsOfTab().length / PER_PAGE));
    this.page = (this.page + 1) % pages;
    this.refresh();
  }

  private refresh(): void {
    const all = this.itemsOfTab();
    const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    this.visible = Array.from({ length: PER_PAGE }, (_, index) => all[this.page * PER_PAGE + index]);

    this.pageText.setText(`${this.page + 1}/${pages}  ▶`);
    this.visible.forEach((itemId, index) => {
      this.cellIcons[index]!.setItem(itemId ?? null);
      this.cellBoxes[index]!.setAlpha(itemId ? 1 : 0.3);
      // 아이콘이 없는 아이템도 있어서 이름을 항상 남긴다. "도끼 T1"처럼 티어가 뒤에
      // 붙는 이름이 많아 잘리면 T1/T2 구분이 사라지므로 6글자까지 보여준다.
      this.cellLabels[index]!.setText(itemId ? (itemsData[itemId]!.name ?? itemId).slice(0, 6) : '');
    });
    this.detailText.setText('');
  }

  private showDetail(index: number): void {
    const itemId = this.visible[index];
    if (!itemId) {
      this.detailText.setText('');
      return;
    }
    const item = itemsData[itemId]!;
    const bits = [item.name, itemId];
    if (item.rarity) bits.push(item.rarity);
    if (item.buyPrice !== undefined) bits.push(`${item.buyPrice} G`);
    this.detailText.setText(bits.join(' · '));
  }

  private takeItem(index: number): void {
    const itemId = this.visible[index];
    if (!itemId) return;

    // Shift를 누른 채 누르면 한 번에 10개 — 스택 표시나 소모 테스트에 한 개씩은 부족하다.
    const event = this.scene.input.activePointer.event as { shiftKey?: boolean } | undefined;
    this.onCommand(`give ${itemId} ${event?.shiftKey ? 10 : 1}`);
  }
}
