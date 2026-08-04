import { describe, expect, it } from 'vitest';
import { BuildingRegistry } from '../src/sim/building';

describe('BuildingRegistry', () => {
  it('빈 셀엔 배치할 수 있고, 배치 후 같은 셀엔 다시 배치할 수 없다', () => {
    const registry = new BuildingRegistry();

    expect(registry.canPlace(3, 4)).toBe(true);
    registry.place('b1', 'fence', 3, 4, 48, 64);
    expect(registry.canPlace(3, 4)).toBe(false);
  });

  it('place는 buildingsData 기준 hp/maxHp를 채운 엔티티를 돌려주고 등록한다', () => {
    const registry = new BuildingRegistry();

    const building = registry.place('b1', 'wall', 1, 1, 16, 16);

    expect(building).toEqual({
      id: 'b1',
      type: 'wall',
      cx: 1,
      cy: 1,
      x: 16,
      y: 16,
      hp: 200,
      maxHp: 200,
    });
    expect(registry.get('b1')).toEqual(building);
  });

  it('at(cx, cy)로 그 셀의 건축물을 조회할 수 있다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'fence', 2, 2, 32, 32);

    expect(registry.at(2, 2)?.id).toBe('b1');
    expect(registry.at(9, 9)).toBeUndefined();
  });

  it('remove하면 id 조회와 셀 점유 모두 풀린다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'fence', 2, 2, 32, 32);

    registry.remove('b1');

    expect(registry.get('b1')).toBeUndefined();
    expect(registry.at(2, 2)).toBeUndefined();
    expect(registry.canPlace(2, 2)).toBe(true);
  });

  it('존재하지 않는 id를 remove해도 안전하게 무시한다', () => {
    const registry = new BuildingRegistry();
    expect(() => registry.remove('nope')).not.toThrow();
  });

  it('울타리는 이동만 막고 투사체는 막지 않는다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'fence', 0, 0, 0, 0);

    expect(registry.isBlockedForMovement(0, 0)).toBe(true);
    expect(registry.isBlockedForProjectile(0, 0)).toBe(false);
  });

  it('벽은 이동과 투사체를 모두 막는다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'wall', 0, 0, 0, 0);

    expect(registry.isBlockedForMovement(0, 0)).toBe(true);
    expect(registry.isBlockedForProjectile(0, 0)).toBe(true);
  });

  it('건축물이 없는 셀은 이동/투사체 둘 다 막지 않는다', () => {
    const registry = new BuildingRegistry();

    expect(registry.isBlockedForMovement(5, 5)).toBe(false);
    expect(registry.isBlockedForProjectile(5, 5)).toBe(false);
  });

  it('values()는 등록된 모든 건축물을 순회한다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'fence', 0, 0, 0, 0);
    registry.place('b2', 'wall', 1, 0, 16, 0);

    const ids = [...registry.values()].map((b) => b.id).sort();
    expect(ids).toEqual(['b1', 'b2']);
  });

  it('entries()는 id로 조회 가능한 전체 맵을 돌려준다', () => {
    const registry = new BuildingRegistry();
    registry.place('b1', 'fence', 0, 0, 0, 0);

    const entries = registry.entries();
    expect(entries.get('b1')?.type).toBe('fence');
    expect(entries.size).toBe(1);
  });
});
