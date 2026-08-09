import Phaser from 'phaser';
import { itemOfSlot, type InventorySlot, type SlotContainer } from '@dropfall/shared';
import { BODY_TEXT, FONT_SMALL, SIZE_SMALL } from './theme';
import { createItemIcon } from '../render/itemSprite';

/** 드래그 유령은 모달보다도 위에 떠야 한다. */
const DEPTH_GHOST = 30000;
/** 커서를 따라다니는 그림의 크기와 투명도. 아래 칸이 비쳐야 어디에 놓는지가 보인다. */
const GHOST_SIZE = 44;
const GHOST_ALPHA = 0.72;
const ACCENT_HEX = 0x6fd08c;
const IDLE_STROKE = 0x4a5262;

/**
 * 놓을 수 있는 자리. 'trash'는 **칸이 아니라 구멍**이다 — 창고 탭 아래 폐기 구역으로,
 * 여기 놓은 물건은 옮겨지지 않고 발밑에 떨어진다(World.discardItem).
 */
export type DragTarget = SlotContainer | 'trash';

/** 폐기할 수 있는 출발지. 충전·제작 칸은 "넣어 둔 것"이라 버리는 몸짓을 받지 않는다. */
function isDiscardable(container: DragTarget): container is 'inventory' | 'storage' {
  return container === 'inventory' || container === 'storage';
}

export interface DragCell {
  container: DragTarget;
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

  /**
   * 옮기지 않고 **제자리에서 뗀 클릭**일 때 호출된다(게임 흐름 피드백 — 예전엔 드래그를
   * 시작했다가 아무 일 없이 취소되는 게 다였다. 퀵슬롯을 좌클릭만으로 손에 들 방법이
   * 없어서, 드래그앤드롭으로 옮기는 것 말고는 무기를 바꿀 길이 숫자키뿐이었다).
   * HudScene이 inventory 칸에 한해 connection.selectSlot으로 배선한다 — 창고 등
   * 다른 칸은 "손에 든다"는 개념이 없어 무시한다.
   */
  onClickSelect: (container: SlotContainer, index: number) => void = () => {};

  /**
   * 쉬프트+클릭했을 때 호출된다(docs/backend/44). HudScene이
   * connection.quickMoveItem으로 배선한다 — 목적지 칸은 여기서 정하지 않는다
   * (반대편 컨테이너 안 어디에 넣을지는 서버가 고른다).
   */
  onQuickMove: (container: SlotContainer, index: number) => void = () => {};

  /**
   * 폐기 구역에 놓았을 때. HudScene이 connection.discardItem으로 배선한다 —
   * 물건은 사라지지 않고 발밑에 떨어지므로 잘못 놓아도 되돌릴 수 있다.
   */
  onDiscard: (container: 'inventory' | 'storage', index: number) => void = () => {};

  /**
   * 물건을 든 손이 폐기 구역 위에 있는가. 놓으면 사라지는 자리라 놓기 **전에**
   * 알려야 한다 — 창고 탭이 이 신호로 휴지통 칸을 물들인다.
   */
  onTrashHover: (armed: boolean) => void = () => {};
  /**
   * 옮길 수 없는 조합(예: 충전 칸에 무기)을 화면이 먼저 거른다. true를 돌려주면
   * 요청을 보내지 않는다 — 서버에 보내 봐야 아무 일도 안 일어나고, 그러면 사용자는
   * "안 된 것"과 "안 눌린 것"을 구분할 수 없다.
   */
  isRejected: (to: SlotContainer, toIndex: number, itemId: string) => boolean = () => false;

  /**
   * 칸 내용 조회. 빈 칸은 집을 수 없어야 해서 최신 스냅샷을 물어본다.
   * 폐기 구역('trash')은 항상 비어 있다 — 그래서 거기서는 아무것도 집히지 않는다.
   */
  getSlot: (container: DragTarget, index: number) => InventorySlot | null = () => null;

  private readonly cells: DragCell[] = [];
  private source: DragCell | null = null;
  private ghost: Phaser.GameObjects.GameObject | null = null;
  private hover: DragCell | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onPointerMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
  }

  /** 칸을 드래그 공간에 등록한다. box는 setInteractive가 이미 걸려 있어야 한다. */
  register(cell: DragCell): void {
    this.cells.push(cell);
    cell.box.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      // 쉬프트를 누른 채 클릭하면 드래그 대신 반대편 컨테이너로 바로 옮긴다
      // (docs/backend/44). pointer.event는 네이티브 DOM 이벤트라 shiftKey를
      // 그대로 읽을 수 있다.
      if ((pointer.event as MouseEvent | undefined)?.shiftKey) {
        this.quickMove(cell);
      } else {
        this.beginDrag(cell);
      }
    });
  }

  /** 드래그 중인지. 이 동안은 좌클릭이 공격으로 새면 안 된다(HudScene의 입력 차단). */
  isDragging(): boolean {
    return this.source !== null;
  }

  /** 지금 포인터가 올라가 있는 칸(강조 표시용). 퀵슬롯 바가 매 프레임 물어본다. */
  hoverCellOf(container: SlotContainer): number | null {
    return this.hover?.container === container ? this.hover.index : null;
  }

  /** 쉬프트+클릭 빠른 이동(docs/backend/44). 드래그 상태를 전혀 안 건드린다 —
   * 유령도 안 띄우고 그 자리에서 바로 요청만 보낸다. */
  private quickMove(cell: DragCell): void {
    if (cell.container === 'trash') return; // 버리는 자리에는 "반대편"이 없다
    if (!cell.isActive()) return;
    const slot = this.getSlot(cell.container, cell.index);
    if (!slot) return; // 빈 칸은 옮길 게 없다

    this.onQuickMove(cell.container, cell.index);
  }

  private beginDrag(cell: DragCell): void {
    if (!cell.isActive()) return;
    const slot = this.getSlot(cell.container, cell.index);
    if (!slot) return; // 빈 칸은 집을 게 없다

    this.source = cell;
    const item = itemOfSlot(slot);

    // 집은 물건의 **그림**이 커서를 따라온다. 예전엔 이름표(글자)가 붙어 다녀서, 무엇을
    // 집었는지는 알아도 어디에 놓는지가 눈에 안 들어왔다 — 칸도 그림으로 채워져 있으니
    // 손에 든 것도 같은 그림이라야 "이걸 저기로 옮긴다"가 한 번에 읽힌다.
    // 반투명으로 둬서 아래 칸이 비쳐 보이게 한다(놓을 자리를 가리면 안 된다).
    const icon = createItemIcon(this.scene, slot.itemId, GHOST_SIZE);
    this.ghost =
      icon?.setAlpha(GHOST_ALPHA).setDepth(DEPTH_GHOST) ??
      this.scene.add
        // 아이콘이 없는 아이템(아틀라스 미빌드 등)은 예전처럼 이름표로 떨어진다.
        .text(0, 0, item?.name ?? slot.itemId, {
          fontFamily: FONT_SMALL,
          fontSize: `${SIZE_SMALL}px`,
          color: BODY_TEXT,
          backgroundColor: '#14161d',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5, 0.5)
        .setAlpha(GHOST_ALPHA)
        .setDepth(DEPTH_GHOST);

    const pointer = this.scene.input.activePointer;
    this.moveGhost(pointer.x, pointer.y);
  }

  /** 고스트는 Image이거나 Text라 공통 상위 타입에는 setPosition이 없다 — 한 곳에서 좁힌다. */
  private moveGhost(x: number, y: number): void {
    (this.ghost as Phaser.GameObjects.Components.Transform | null)?.setPosition(x, y);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.ghost) return;
    this.moveGhost(pointer.x, pointer.y);

    const over = this.cellAt(pointer.x, pointer.y);
    if (over === this.hover) return;

    // 모달 칸의 강조는 여기서 직접 칠한다. 퀵슬롯은 매 프레임 스스로 다시 칠하므로
    // hoverCellOf로 물어가게 둔다(여기서 칠해도 다음 프레임에 덮인다).
    if (this.hover && this.hover.container === 'storage') {
      this.hover.box.setStrokeStyle(1, IDLE_STROKE);
    }
    if (this.hover?.container === 'trash') this.onTrashHover(false);
    this.hover = over;
    if (over && over.container === 'storage' && over !== this.source) {
      over.box.setStrokeStyle(2, ACCENT_HEX);
    }
    // 폐기 구역은 **버릴 수 있는 것을 들었을 때만** 켠다 — 충전 칸에서 집어 온 물건을
    // 올려놓고 켜지면 놓아도 아무 일이 없는 이유를 알 수 없다.
    if (over?.container === 'trash' && this.source && isDiscardable(this.source.container)) {
      this.onTrashHover(true);
    }
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.source) return;

    const source = this.source;
    const target = this.cellAt(pointer.x, pointer.y);
    this.endDrag();

    if (!target) return;
    if (target === source) {
      // 옮기지 않고 같은 칸에서 뗐다 — "그냥 눌렀다"로 본다.
      if (source.container !== 'trash') this.onClickSelect(source.container, source.index);
      return;
    }

    // 폐기 구역에 놓았다. 옮기는 게 아니라 버리는 거라 onMove를 타지 않는다.
    if (target.container === 'trash') {
      if (isDiscardable(source.container)) this.onDiscard(source.container, source.index);
      return;
    }
    if (source.container === 'trash') return; // 폐기 구역에서는 아무것도 못 집는다

    const slot = this.getSlot(source.container, source.index);
    if (slot && this.isRejected(target.container, target.index, slot.itemId)) return;

    this.onMove(source.container, source.index, target.container, target.index);
  }

  private endDrag(): void {
    this.ghost?.destroy();
    this.ghost = null;
    this.source = null;
    if (this.hover?.container === 'storage') this.hover.box.setStrokeStyle(1, IDLE_STROKE);
    if (this.hover?.container === 'trash') this.onTrashHover(false);
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
