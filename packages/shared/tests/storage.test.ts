import { describe, expect, it } from 'vitest';
import { CoreStorage, STORAGE_SLOT_COUNT } from '../src/sim/storage';

describe('CoreStorage', () => {
  it('빈 창고는 아무것도 세지 않는다', () => {
    const storage = new CoreStorage();
    expect(storage.countOf('wood')).toBe(0);
    expect(storage.toView().slots).toHaveLength(STORAGE_SLOT_COUNT);
  });

  it('같은 아이템이 여러 칸에 나뉘어도 합쳐서 센다', () => {
    const storage = new CoreStorage();
    // wood stackSize=200 → 450개는 3칸에 나뉜다
    storage.add('wood', 450);

    expect(storage.countOf('wood')).toBe(450);
  });

  it('consume은 여러 칸에 걸쳐 빼낸다', () => {
    const storage = new CoreStorage();
    storage.add('wood', 450);

    expect(storage.consume('wood', 300)).toBe(true);
    expect(storage.countOf('wood')).toBe(150);
  });

  it('모자라면 아무것도 빼지 않는다(건축 비용이 반만 나가면 안 된다)', () => {
    const storage = new CoreStorage();
    storage.add('wood', 10);

    expect(storage.consume('wood', 50)).toBe(false);
    expect(storage.countOf('wood')).toBe(10);
  });

  it('0개 소비는 항상 성공한다(비용이 0인 건축물)', () => {
    const storage = new CoreStorage();
    expect(storage.consume('stone', 0)).toBe(true);
  });

  it('꽉 차면 못 넣은 개수를 돌려준다', () => {
    const storage = new CoreStorage();
    // 20칸 × stackSize 1(무기) = 20개가 한계
    const leftover = storage.add('handgun', 25);

    expect(leftover).toBe(5);
    expect(storage.countOf('handgun')).toBe(20);
  });

  it('도구도 재료와 같은 방식으로 보관된다', () => {
    const storage = new CoreStorage();
    storage.add('axe_t1', 1);
    storage.add('bandage', 3);

    expect(storage.slotAt(0)).toEqual({ itemId: 'axe_t1', count: 1 });
    expect(storage.countOf('bandage')).toBe(3);
  });

  it('칸에서 직접 빼면 그만큼 줄고, 0이 되면 칸이 비워진다', () => {
    const storage = new CoreStorage();
    storage.add('stone', 5);

    expect(storage.removeAt(0, 5)).toBe(5);
    expect(storage.slotAt(0)).toBeNull();
  });
});
