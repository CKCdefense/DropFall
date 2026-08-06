import { itemsData, type ItemData } from '../data';

/**
 * 플레이어 인벤토리 — 퀵슬롯 한 줄.
 *
 * 이 클래스는 **서버 권위**다. 클라이언트는 "몇 번 슬롯을 고르겠다"와 "쓰겠다"만 보내고,
 * 무엇을 들고 있는지·쓸 수 있는지는 전부 여기서 판정한다. 클라이언트가 무기 id를
 * 직접 실어 보내던 방식은 아무 무기나 주장할 수 있어서 폐기했다.
 *
 * 확장 시 유의: 슬롯 배열은 길이가 항상 SLOT_COUNT로 고정이고 빈 칸은 null이다.
 * "배열에서 빼기"가 아니라 "그 자리를 비우기"라야 UI의 칸 번호가 흔들리지 않는다.
 */

/** 퀵슬롯 개수. HUD 하단 칸 수와 같은 값이다(와이어프레임 기준 4칸). */
export const SLOT_COUNT = 4;

export interface InventorySlot {
  itemId: string;
  count: number;
}

/** 인벤토리 밖으로 나가는 읽기 전용 표현. 스냅샷/네트워크로 그대로 흘려보낸다. */
export interface InventoryView {
  slots: (InventorySlot | null)[];
  selectedIndex: number;
}

function itemOf(itemId: string): ItemData | undefined {
  return itemsData[itemId];
}

/**
 * 슬롯에 든 아이템 정의를 꺼낸다. 빈 칸이거나 모르는 id면 undefined.
 * 클라이언트도 "이 칸이 무기인가 소모품인가"를 알아야 좌클릭 동작을 고를 수 있어서 내보낸다.
 */
export function itemOfSlot(slot: InventorySlot | null | undefined): ItemData | undefined {
  return slot ? itemOf(slot.itemId) : undefined;
}

export class Inventory {
  private readonly slots: (InventorySlot | null)[];
  private selectedIndex = 0;

  /**
   * 칸 수를 받는다 — 퀵슬롯은 SLOT_COUNT(4), 코어 창고는 더 넉넉한 칸을 쓴다
   * (storage.ts). 스택·빈 칸 규칙이 같아서 같은 클래스를 공유한다.
   */
  constructor(private readonly slotCount: number = SLOT_COUNT) {
    this.slots = Array.from({ length: slotCount }, () => null);
  }

  /**
   * 아이템을 넣는다. 같은 아이템이 있는 칸에 먼저 쌓고, 남으면 빈 칸을 채운다.
   * 다 못 넣으면 **남은 개수**를 반환한다 — 호출자가 "가방이 꽉 찼다"를 알 수 있어야
   * 자원 노드에서 캔 것을 조용히 증발시키지 않는다.
   */
  add(itemId: string, count = 1): number {
    const item = itemOf(itemId);
    if (!item || count <= 0) return count;

    let remaining = count;

    // 1단계: 이미 있는 더미에 쌓는다.
    for (const slot of this.slots) {
      if (remaining <= 0) break;
      if (!slot || slot.itemId !== itemId) continue;

      const room = item.stackSize - slot.count;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    // 2단계: 빈 칸을 새로 연다.
    for (let index = 0; index < this.slots.length; index += 1) {
      if (remaining <= 0) break;
      if (this.slots[index]) continue;

      const moved = Math.min(item.stackSize, remaining);
      this.slots[index] = { itemId, count: moved };
      remaining -= moved;
    }

    return remaining;
  }

  /** 슬롯에서 개수를 뺀다. 0이 되면 칸을 비운다. 실제로 뺀 개수를 반환한다. */
  removeAt(index: number, count = 1): number {
    const slot = this.slotAt(index);
    if (!slot || count <= 0) return 0;

    const removed = Math.min(slot.count, count);
    slot.count -= removed;
    if (slot.count <= 0) this.slots[index] = null;
    return removed;
  }

  /** 유효한 칸 번호면 선택하고 true를 반환한다. 빈 칸도 선택할 수 있다(맨손). */
  select(index: unknown): boolean {
    if (typeof index !== 'number' || !Number.isInteger(index)) return false;
    if (index < 0 || index >= this.slotCount) return false;

    this.selectedIndex = index;
    return true;
  }

  slotAt(index: number): InventorySlot | null {
    return this.slots[index] ?? null;
  }

  get selected(): InventorySlot | null {
    return this.slotAt(this.selectedIndex);
  }

  /**
   * 지금 장착 중인 무기 id. 무기가 아닌 걸 들고 있으면 undefined다 —
   * 이 경우 공격 자체가 성립하지 않는다(맨손 공격은 아직 없다).
   */
  get equippedWeaponId(): string | undefined {
    const slot = this.selected;
    if (!slot) return undefined;

    const item = itemOf(slot.itemId);
    return item?.kind === 'weapon' ? item.weaponId : undefined;
  }

  /**
   * 선택 중인 소모품을 1개 쓴다. 쓸 수 없으면 undefined.
   * 실제 효과(회복 등)는 호출자인 World가 적용한다 — 인벤토리는 소모만 책임진다.
   */
  consumeSelected(): ItemData | undefined {
    const slot = this.selected;
    if (!slot) return undefined;

    const item = itemOf(slot.itemId);
    if (item?.kind !== 'consumable') return undefined;

    this.removeAt(this.selectedIndex, 1);
    return item;
  }

  /**
   * 칸의 내용을 통째로 꺼낸다(칸은 비워진다). 드래그앤드롭처럼 "집어서 다른 곳에 놓는"
   * 조작에 쓴다 — add()는 빈 칸을 알아서 고르기 때문에 목적지를 지정할 수 없다.
   */
  takeAt(index: number): InventorySlot | null {
    const slot = this.slotAt(index);
    if (!slot) return null;
    this.slots[index] = null;
    return slot;
  }

  /**
   * 지정한 칸에 놓는다. 결과는 셋 중 하나다:
   *  - 빈 칸이면 그대로 놓인다
   *  - 같은 아이템이면 stackSize까지 합치고 남은 것을 돌려준다
   *  - 다른 아이템이면 자리를 바꾼다(밀려난 것을 돌려준다)
   *
   * 돌려준 값은 호출자가 원래 자리로 되돌려야 한다 — 그래야 아이템이 사라지지 않는다.
   */
  placeAt(index: number, incoming: InventorySlot): InventorySlot | null {
    if (index < 0 || index >= this.slotCount) return incoming;

    const item = itemOf(incoming.itemId);
    if (!item) return incoming;

    const existing = this.slots[index];
    if (!existing) {
      this.slots[index] = { ...incoming };
      return null;
    }

    if (existing.itemId === incoming.itemId) {
      const room = item.stackSize - existing.count;
      const moved = Math.min(room, incoming.count);
      existing.count += moved;

      const leftover = incoming.count - moved;
      return leftover > 0 ? { itemId: incoming.itemId, count: leftover } : null;
    }

    // 다른 아이템 — 자리를 바꾼다.
    this.slots[index] = { ...incoming };
    return existing;
  }

  /**
   * 인벤토리 전체에서 이 아이템이 몇 개인지. 같은 아이템이 여러 칸에 나뉠 수 있어서
   * 전부 훑는다 — HUD가 "들고 있는 나무 N개"를 보여줄 때 쓴다.
   */
  countOf(itemId: string): number {
    let total = 0;
    for (const slot of this.slots) {
      if (slot?.itemId === itemId) total += slot.count;
    }
    return total;
  }

  /** 네트워크로 보낼 스냅샷. 내부 배열을 그대로 넘기면 밖에서 수정될 수 있어 복사한다. */
  toView(): InventoryView {
    return {
      slots: this.slots.map((slot) => (slot ? { ...slot } : null)),
      selectedIndex: this.selectedIndex,
    };
  }
}
