import Phaser from 'phaser';
import { itemOfSlot, type InventorySlot, type SlotContainer } from '@dropfall/shared';
import { BODY_TEXT, FONT_SMALL, SIZE_SMALL } from './theme';

/** 드래그 유령은 모달보다도 위에 떠야 한다. */
const DEPTH_GHOST = 30000;
const ACCENT_HEX = 0x6fd08c;
const IDLE_STROKE = 0x4a5262;

export interface DragCell {
  container: SlotContainer;
  index: number;
  box: Phaser.GameObjects.Rectangle;
  /** 지금 이 칸을 집거나 놓을 수 있는지(모달이 닫혀 있으면 창고 칸은 죽는다). */
  isActive: () => boolean;
}

/**
 * 슬롯 드래그앤드롭 공용 컨트롤러.
 *
 * 창고 모달 안의 격자와 화면 하단 퀵슬롯 HUD는 **다른 UI 조각이지만 같은 드래그 공간**
 * 이어야 한다 — 창고에서 곡괭이를 집어 퀵슬롯에 바로 놓을 수 있어야 한다. 그래서 드래그
 * 로직을 모달 안에 두지 않고, 칸을 등록받는 컨트롤러 하나가 씬 전역 포인터를 듣는다.
 *
 * 상태는 서버가 소유한다 — 놓는 순간 onMove(이동 요청)만 보내고 화면은 다음 스냅샷에서
 * 바뀐다. 유령/강조는 순수 연출이다.
 */
export class SlotDrag {
  /** 놓았을 때 호출된다. HudScene이 connection.moveItem으로 배선한다. */
  onMove: (
    from: SlotContainer,
    fromIndex: number,
    to: SlotContainer,
    toIndex: number,
  ) => void = () => {};

  /** 칸 내용 조회. 빈 칸은 집을 수 없어야 해서 최신 스냅샷을 물어본다. */
  getSlot: (container: SlotContainer, index: number) => InventorySlot | null = () => null;

  private readonly cells: DragCell[] = [];
  private source: DragCell | null = null;
  private ghost: Phaser.GameObjects.Text | null = null;
  private hover: DragCell | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
  }

  /** 칸을 드래그 공간에 등록한다. box는 setInteractive가 이미 걸려 있어야 한다. */
  register(cell: DragCell): void {
    this.cells.push(cell);
    cell.box.on('pointerdown', () => this.beginDrag(cell));
  }

  /** 드래그 중인지. 이 동안은 좌클릭이 공격으로 새면 안 된다(HudScene의 입력 차단). */
  isDragging(): boolean {
    return this.source !== null;
  }

  /** 지금 포인터가 올라가 있는 칸(강조 표시용). 퀵슬롯 바가 매 프레임 물어본다. */
  hoverCellOf(container: SlotContainer): number | null {
    return this.hover?.container === container ? this.hover.index : null;
  }

  private beginDrag(cell: DragCell): void {
    if (!cell.isActive()) return;
    const slot = this.getSlot(cell.container, cell.index);
    if (!slot) return; // 빈 칸은 집을 게 없다

    this.source = cell;
    const item = itemOfSlot(slot);
    this.ghost = this.scene.add
      .text(0, 0, item?.name ?? slot.itemId, {
        fontFamily: FONT_SMALL,
        fontSize: `${SIZE_SMALL}px`,
        color: BODY_TEXT,
        backgroundColor: '#14161d',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH_GHOST);

    const pointer = this.scene.input.activePointer;
    this.ghost.setPosition(pointer.x, pointer.y);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.ghost) return;
    this.ghost.setPosition(pointer.x, pointer.y);

    const over = this.cellAt(pointer.x, pointer.y);
    if (over === this.hover) return;

    // 모달 칸의 강조는 여기서 직접 칠한다. 퀵슬롯은 매 프레임 스스로 다시 칠하므로
    // hoverCellOf로 물어가게 둔다(여기서 칠해도 다음 프레임에 덮인다).
    if (this.hover && this.hover.container === 'storage') {
      this.hover.box.setStrokeStyle(1, IDLE_STROKE);
    }
    this.hover = over;
    if (over && over.container === 'storage' && over !== this.source) {
      over.box.setStrokeStyle(2, ACCENT_HEX);
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.source) return;

    const source = this.source;
    const target = this.cellAt(pointer.x, pointer.y);
    this.endDrag();

    if (!target || target === source) return;
    this.onMove(source.container, source.index, target.container, target.index);
  }

  private endDrag(): void {
    this.ghost?.destroy();
    this.ghost = null;
    this.source = null;
    if (this.hover?.container === 'storage') this.hover.box.setStrokeStyle(1, IDLE_STROKE);
    this.hover = null;
  }

  /**
   * 화면 좌표가 어느 칸 위인지. 칸이 컨테이너(모달) 안에 있을 수 있어 월드 변환으로
   * 판정한다 — displayWidth를 쓰므로 퀵슬롯처럼 배율이 걸린 칸도 맞는다.
   */
  private cellAt(x: number, y: number): DragCell | null {
    for (const cell of this.cells) {
      if (!cell.isActive() || !cell.box.visible) continue;
      const m = cell.box.getWorldTransformMatrix();
      const w = cell.box.displayWidth;
      const h = cell.box.displayHeight;
      if (x >= m.tx && x < m.tx + w && y >= m.ty && y < m.ty + h) return cell;
    }
    return null;
  }
}
