import Phaser from 'phaser';
import type { InventorySlot } from '@dropfall/shared';
import { Modal } from './Modal';
import { CraftPanel } from './CraftPanel';
import { StorePanel } from './StorePanel';
import { WarehousePanel, type StorageCellHandle } from './WarehousePanel';
import { ACCENT, FONT_SMALL, SIZE_SMALL } from './theme';

/**
 * 창 크기. 예전엔 220×240이라 안에 정보 세 줄과 버튼 여섯 개가 겨우 들어갔고, 제작·상점·
 * 창고는 각자 또 다른 작은 창으로 떠서 화면에 창이 두세 개씩 겹쳤다. 코어 앞에서 하는
 * 일이 전부 한 창 안에 있어야 "코어를 조작한다"는 하나의 행동이 된다.
 */
const PANEL_WIDTH = 620;
const PANEL_HEIGHT = 400;

const ROW_GAP = 20;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 10;
/** 코어 탭의 정보/버튼이 차지하는 폭. 남은 오른쪽은 코어 AI 대사에 준다. */
const INFO_WIDTH = 260;

/** 탭 순서 = 와이어프레임의 왼쪽부터. 숫자로 부르지 않게 이름을 붙여 둔다. */
export const CORE_TAB = { CORE: 0, CRAFT: 1, STORE: 2, WAREHOUSE: 3 } as const;
export type CoreTab = (typeof CORE_TAB)[keyof typeof CORE_TAB];

/**
 * 코어 앞에서 여는 허브 창 — **상단 탭 하나에 코어/제작/상점/창고가 모두 들어 있다.**
 *
 * 예전에는 코어 모달이 "다른 모달을 여는 버튼 판"이었다. 창고에서 재료를 확인하고
 * 제작으로 가려면 창을 닫고 다시 열어야 했고, 두 창을 같이 띄우면 서로를 가렸다.
 * 탭이면 재료를 본 상태 그대로 옆 탭으로 넘어갈 수 있고, 창은 언제나 하나다.
 *
 * 각 탭의 내용은 별도 클래스(CraftPanel/StorePanel/WarehousePanel)가 그린다 — 이 클래스는
 * 창과 탭만 책임지고, 무엇을 파는지·무엇을 만드는지는 각 패널이 안다.
 */
export class CoreModal extends Modal {
  onManage: () => void = () => {};

  private readonly craft: CraftPanel;
  private readonly store: StorePanel;
  private readonly warehouse: WarehousePanel;

  /** "에너지" 행 값 텍스트. 콜로니 정화로 얻는 팀 공유 자원(docs/backend/35). */
  private readonly energyValueText: Phaser.GameObjects.Text;
  /** 코어 AI 페르소나 대사. 아직 아무 일도 없었으면 빈 문자열(조용한 게 자연스럽다). */
  private readonly commentaryText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    super(scene, {
      title: '코어',
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      tabs: ['코어', '제작', '상점', '창고'],
    });

    const core = this.buildCoreTab(scene);
    this.energyValueText = core.energy;
    this.commentaryText = core.commentary;

    this.craft = new CraftPanel(this.pageBuilder(CORE_TAB.CRAFT));
    this.store = new StorePanel(this.pageBuilder(CORE_TAB.STORE));
    this.warehouse = new WarehousePanel(this.pageBuilder(CORE_TAB.WAREHOUSE));
  }

  /** 코어 탭 — 상태 요약과 코어 자체를 다루는 행동(주입·관리). */
  private buildCoreTab(scene: Phaser.Scene): {
    energy: Phaser.GameObjects.Text;
    commentary: Phaser.GameObjects.Text;
  } {
    const page = this.pageBuilder(CORE_TAB.CORE);
    // 정보 행은 왼쪽 열 안에서만 좌우로 벌어진다 — 창이 넓어져서 전체폭으로 두면
    // 레이블과 값이 화면 양끝으로 갈라져 한눈에 안 읽힌다.
    const column = page.narrow(INFO_WIDTH);

    column.addRow(0, '가격', '-');
    column.addRow(ROW_GAP, '자원', '0');
    const energy = column.addRow(ROW_GAP * 2, '에너지', '0');

    const actionY = ROW_GAP * 3 + 6;
    column.addButton(0, actionY, INFO_WIDTH, BUTTON_HEIGHT, '주입', () => {
      // 아직 실제 주입 로직 없음 — 클릭 배선만 확인하는 자리.
      console.log('[CoreModal] 주입');
    });
    column.addButton(
      0,
      actionY + BUTTON_HEIGHT + BUTTON_GAP,
      INFO_WIDTH,
      BUTTON_HEIGHT,
      '코어 관리',
      () => this.onManage(),
    );

    // 대사는 오른쪽 절반을 쓴다 — 정보 행과 같은 줄에 두면 둘 다 잘린다.
    const commentaryX = INFO_WIDTH + 24;
    const commentary = scene.add
      .text(commentaryX, 0, '', {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: ACCENT,
        wordWrap: { width: page.width - commentaryX },
      })
      .setOrigin(0, 0);
    page.add(commentary);

    return { energy, commentary };
  }

  /** 코어 공유 에너지(coreSharedEnergy)를 반영한다. HudScene이 스냅샷마다 호출한다. */
  setEnergy(value: number): void {
    this.energyValueText.setText(String(value));
  }

  /** 코어 AI 페르소나의 새 대사를 반영한다. HudScene이 onCoreCommentary 콜백에서 호출한다. */
  setCommentary(text: string): void {
    this.commentaryText.setText(`"${text}"`);
  }

  // ------------------------------------------------------------------ 탭 위임
  //
  // 바깥(HudScene)에서 보면 창이 하나이므로, 각 탭의 콜백·갱신도 이 창의 것처럼 보이게
  // 넘긴다. 어느 탭이 무엇을 담당하는지는 이 클래스 안에서만 알면 된다.

  set onCraft(handler: (recipeId: string) => void) {
    this.craft.onCraft = handler;
  }

  set onPurchase(handler: (itemId: string) => void) {
    this.store.onPurchase = handler;
  }

  set onSell(handler: (itemId: string, count: number) => void) {
    this.store.onSell = handler;
  }

  setCraftContext(stock: Record<string, number>, coreTier: number): void {
    this.craft.setContext(stock, coreTier);
  }

  setStoreContext(stock: string[], money: number, storage: Record<string, number>): void {
    this.store.setContext(stock, money, storage);
  }

  setStorageSlots(storage: (InventorySlot | null)[]): void {
    this.warehouse.setSlots(storage);
  }

  /** 창고 칸 손잡이. SlotDrag가 드래그앤드롭 대상으로 등록한다. */
  get storageCells(): readonly StorageCellHandle[] {
    return this.warehouse.storageCells;
  }

  /** 창고 탭이 실제로 보이는 상태인가. 드래그앤드롭이 "지금 이 칸이 살아 있나"를 물을 때 쓴다. */
  isWarehouseVisible(): boolean {
    return this.isOpen() && this.currentTab === CORE_TAB.WAREHOUSE;
  }
}
