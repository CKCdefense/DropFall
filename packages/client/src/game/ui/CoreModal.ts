import Phaser from 'phaser';
import type { InventorySlot } from '@dropfall/shared';
import { Modal } from './Modal';
import { CorePanel, type ChargeCellHandle } from './CorePanel';
import { CraftPanel } from './CraftPanel';
import { StorePanel } from './StorePanel';
import { WarehousePanel, type StorageCellHandle } from './WarehousePanel';


/**
 * 창 크기. 예전엔 220×240이라 안에 정보 세 줄과 버튼 여섯 개가 겨우 들어갔고, 제작·상점·
 * 창고는 각자 또 다른 작은 창으로 떠서 화면에 창이 두세 개씩 겹쳤다. 코어 앞에서 하는
 * 일이 전부 한 창 안에 있어야 "코어를 조작한다"는 하나의 행동이 된다.
 */
/**
 * 가로가 세로보다 길면 격자가 한 줄로 늘어지고 아래 상세 띠만 두꺼워진다.
 * 창고(5열)·제작(4열) 격자가 여러 줄로 쌓이는 **세로가 조금 더 긴 비율**로 잡는다.
 */
const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 640;

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
  private readonly core: CorePanel;
  private readonly craft: CraftPanel;
  private readonly store: StorePanel;
  private readonly warehouse: WarehousePanel;

  constructor(scene: Phaser.Scene) {
    super(scene, {
      title: '코어',
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      tabs: ['코어', '제작', '상점', '창고'],
    });

    this.core = new CorePanel(this.pageBuilder(CORE_TAB.CORE));
    this.craft = new CraftPanel(this.pageBuilder(CORE_TAB.CRAFT));
    this.store = new StorePanel(this.pageBuilder(CORE_TAB.STORE));
    this.warehouse = new WarehousePanel(this.pageBuilder(CORE_TAB.WAREHOUSE));
  }

  set onUpgrade(handler: () => void) {
    this.core.onUpgrade = handler;
  }

  set onRepair(handler: () => void) {
    this.core.onRepair = handler;
  }

  set onReviveGhost(handler: (targetId: string) => void) {
    this.core.onReviveGhost = handler;
  }

  setCoreStatus(status: Parameters<CorePanel['setStatus']>[0]): void {
    this.core.setStatus(status);
  }

  setGhosts(ghosts: { id: string; nickname: string }[], resource: number): void {
    this.core.setGhosts(ghosts, resource);
  }

  setChargeSlots(slots: (InventorySlot | null)[], openCount: number): void {
    this.core.setChargeSlots(slots, openCount);
  }

  isChargeSlotOpen(index: number): boolean {
    return this.core.isChargeSlotOpen(index);
  }

  rejectCharge(index: number): void {
    this.core.rejectCharge(index);
  }

  /** 제작 결과 칸. SlotDrag가 드래그 시작점으로 등록한다. */
  get craftOutputCell(): Phaser.GameObjects.Rectangle {
    return this.craft.craftOutputCell;
  }

  /** 제작 탭이 보이는 상태인가. 결과 칸의 드래그 판정에 쓴다. */
  isCraftTabVisible(): boolean {
    return this.isOpen() && this.currentTab === CORE_TAB.CRAFT;
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

  /** 폐기 칸 손잡이. SlotDrag가 **놓을 자리**로 등록한다. */
  get trashCell(): Phaser.GameObjects.Rectangle {
    return this.warehouse.trashCell;
  }

  /** 물건을 든 손이 폐기 칸 위에 있다고 알린다(SlotDrag → 창고 탭). */
  setTrashArmed(armed: boolean): void {
    this.warehouse.setTrashArmed(armed);
  }

  setCraftContext(context: Parameters<CraftPanel['setContext']>[0]): void {
    this.craft.setContext(context);
  }

  setStoreContext(stock: string[], energy: number, rerollCost: number): void {
    this.store.setContext(stock, energy, rerollCost);
  }

  set onReroll(handler: () => void) {
    this.store.onReroll = handler;
  }

  setStorageSlots(storage: (InventorySlot | null)[]): void {
    this.warehouse.setSlots(storage);
  }

  /** 창고 칸 손잡이. SlotDrag가 드래그앤드롭 대상으로 등록한다. */
  get storageCells(): readonly StorageCellHandle[] {
    return this.warehouse.storageCells;
  }

  /** 충전 칸 손잡이. 창고와 같은 방식으로 드래그앤드롭 대상이 된다. */
  get chargeCells(): readonly ChargeCellHandle[] {
    return this.core.chargeCells;
  }

  /** 코어 탭이 실제로 보이는 상태인가. 충전 칸의 드롭 판정에 쓴다. */
  isCoreTabVisible(): boolean {
    return this.isOpen() && this.currentTab === CORE_TAB.CORE;
  }

  /** 창고 탭이 실제로 보이는 상태인가. 드래그앤드롭이 "지금 이 칸이 살아 있나"를 물을 때 쓴다. */
  isWarehouseVisible(): boolean {
    return this.isOpen() && this.currentTab === CORE_TAB.WAREHOUSE;
  }
}
