import { Inventory, type InventorySlot, type InventoryView } from './inventory';

/**
 * 코어 창고 — 팀 공용 보관함.
 *
 * **왜 Inventory를 그대로 쓰나**
 * 창고와 인벤토리는 "슬롯에 아이템이 쌓여 있다"는 점에서 완전히 같다. 별도 자료구조를
 * 만들면 스택 규칙·빈 칸 처리 같은 걸 두 번 구현하게 되고, 둘 사이에 아이템을 옮길 때
 * 변환 코드가 또 필요하다. 칸 수만 다른 같은 물건으로 두면 이동이 add/removeAt 조합으로
 * 끝난다.
 *
 * **왜 자원까지 슬롯에 넣나**
 * 예전에는 나무/돌이 CoreState의 전용 숫자 필드(sharedWood/sharedStone)였다. 그러면
 * 자원 종류가 늘 때마다 필드와 분기를 추가해야 하고, 도구를 창고에 보관하는 건 아예
 * 불가능하다. 슬롯으로 통일하면 재료든 도구든 같은 경로로 들어간다.
 *
 * 건축 비용 계산처럼 "특정 재료가 몇 개인가"만 필요한 곳은 countOf로 묻는다.
 */

/** 창고 칸 수. 퀵슬롯(4칸)보다 훨씬 넉넉해야 팀이 모은 걸 다 받는다. */
export const STORAGE_SLOT_COUNT = 20;

export class CoreStorage {
  private readonly inventory = new Inventory(STORAGE_SLOT_COUNT);

  /** 넣고 남은 개수를 돌려준다. 창고가 꽉 차면 0이 아닌 값이 나온다. */
  add(itemId: string, count = 1): number {
    return this.inventory.add(itemId, count);
  }

  /** 특정 칸에서 개수를 뺀다. 실제로 뺀 개수를 돌려준다. */
  removeAt(index: number, count = 1): number {
    return this.inventory.removeAt(index, count);
  }

  slotAt(index: number) {
    return this.inventory.slotAt(index);
  }

  takeAt(index: number) {
    return this.inventory.takeAt(index);
  }

  placeAt(index: number, incoming: InventorySlot) {
    return this.inventory.placeAt(index, incoming);
  }

  /**
   * 창고 전체에서 이 아이템이 몇 개인지. 같은 아이템이 여러 칸에 나뉘어 있을 수 있어서
   * 전부 훑는다 — 건축 비용을 확인할 때 쓴다.
   */
  countOf(itemId: string): number {
    let total = 0;
    for (let i = 0; i < STORAGE_SLOT_COUNT; i += 1) {
      const slot = this.inventory.slotAt(i);
      if (slot?.itemId === itemId) total += slot.count;
    }
    return total;
  }

  /**
   * 창고에서 이 아이템을 count개 소비한다. 모자라면 아무것도 빼지 않고 false —
   * 건축 비용처럼 "전부 되거나 전부 안 되거나"여야 하는 곳을 위해서다.
   */
  consume(itemId: string, count: number): boolean {
    if (count <= 0) return true;
    if (this.countOf(itemId) < count) return false;

    let remaining = count;
    for (let i = 0; i < STORAGE_SLOT_COUNT && remaining > 0; i += 1) {
      const slot = this.inventory.slotAt(i);
      if (slot?.itemId !== itemId) continue;
      remaining -= this.inventory.removeAt(i, Math.min(remaining, slot.count));
    }
    return true;
  }

  toView(): InventoryView {
    return this.inventory.toView();
  }
}
