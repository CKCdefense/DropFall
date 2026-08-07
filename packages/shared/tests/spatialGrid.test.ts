import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../src/sim/spatialGrid';

describe('SpatialGrid', () => {
  it('반경 안에 있는 id를 후보로 돌려준다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 0, 0);
    grid.insert('b', 10, 10);
    grid.insert('c', 500, 500); // 멀리 있는 건 후보에 안 들어와야 한다

    const candidates = grid.queryRadius(0, 0, 30);
    expect(candidates).toContain('a');
    expect(candidates).toContain('b');
    expect(candidates).not.toContain('c');
  });

  it('여러 칸에 걸친 반경도 그 칸들의 id를 전부 후보로 준다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('near-origin', 0, 0);
    grid.insert('next-cell', 70, 0); // 칸 크기가 64라 다른 칸

    // 반경이 칸 경계를 넘게 크게 잡으면 둘 다 후보에 들어와야 한다
    expect(grid.queryRadius(0, 0, 80)).toEqual(expect.arrayContaining(['near-origin', 'next-cell']));
  });

  it('remove로 지운 id는 더 이상 후보에 안 나온다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 0, 0);
    grid.remove('a');
    expect(grid.queryRadius(0, 0, 100)).not.toContain('a');
  });

  it('updateEntry로 위치를 옮기면 새 위치 기준으로만 잡힌다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 0, 0);
    grid.updateEntry('a', 1000, 1000);

    expect(grid.queryRadius(0, 0, 50)).not.toContain('a');
    expect(grid.queryRadius(1000, 1000, 50)).toContain('a');
  });

  it('updateEntry가 같은 칸 안에서의 이동이면 계속 잡힌다(칸 경계 안 넘음)', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 0, 0);
    grid.updateEntry('a', 5, 5); // 같은 칸(0,0) 안에서의 소폭 이동

    expect(grid.queryRadius(5, 5, 10)).toContain('a');
  });

  it('clear 이후엔 아무 것도 안 나온다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 0, 0);
    grid.clear();
    expect(grid.queryRadius(0, 0, 1000)).toEqual([]);
  });

  it('같은 칸에 여러 id가 있어도 중복 없이 한 번씩만 후보에 담긴다', () => {
    const grid = new SpatialGrid(64);
    grid.insert('a', 1, 1);
    grid.insert('b', 2, 2);
    const candidates = grid.queryRadius(0, 0, 60);
    expect(candidates.filter((id) => id === 'a')).toHaveLength(1);
    expect(candidates.filter((id) => id === 'b')).toHaveLength(1);
  });

  it('cellSize가 0 이하면 생성 시점에 에러를 던진다', () => {
    expect(() => new SpatialGrid(0)).toThrow();
    expect(() => new SpatialGrid(-1)).toThrow();
  });
});
