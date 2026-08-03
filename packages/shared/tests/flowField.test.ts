import { describe, expect, it } from 'vitest';
import { FlowField } from '../src/sim/ai/flowField';

const GRID = { widthInTiles: 10, heightInTiles: 10, tileSize: 16, originX: -80, originY: -80 };

describe('FlowField', () => {
  it('장애물이 없으면 모든 셀이 목표를 향하는 방향을 가진다', () => {
    const field = new FlowField(GRID);
    field.recompute(5, 5); // 대략 중앙

    const dir = field.sampleDirection(GRID.originX, GRID.originY); // 좌상단 모서리
    expect(dir.x).toBeGreaterThan(0);
    expect(dir.y).toBeGreaterThan(0);
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 5);
  });

  it('목표 셀 자신은 방향 벡터가 없다(이미 도착)', () => {
    const field = new FlowField(GRID);
    field.recompute(5, 5);

    const targetWorldX = GRID.originX + 5 * GRID.tileSize + 1;
    const targetWorldY = GRID.originY + 5 * GRID.tileSize + 1;
    const dir = field.sampleDirection(targetWorldX, targetWorldY);
    expect(dir).toEqual({ x: 0, y: 0 });
  });

  it('벽으로 완전히 막힌 셀은 방향을 못 구한다(도달 불가)', () => {
    const isBlocked = (cx: number) => cx === 3; // 3번째 열 전체를 벽으로 막음
    const field = new FlowField(GRID, isBlocked);
    field.recompute(5, 5);

    const dir = field.sampleDirection(GRID.originX, GRID.originY); // 벽 반대편(0열)
    expect(dir).toEqual({ x: 0, y: 0 });
  });

  it('그리드 범위 밖 좌표는 안전하게 {0,0}을 반환한다', () => {
    const field = new FlowField(GRID);
    field.recompute(5, 5);

    expect(field.sampleDirection(100000, 100000)).toEqual({ x: 0, y: 0 });
  });

  it('장애물을 우회하는 경로를 찾는다', () => {
    // 목표(5,5) 왼쪽에 3번째 열 전체를 막되, 한 칸(cy=0)만 뚫어둔다
    const isBlocked = (cx: number, cy: number) => cx === 3 && cy !== 0;
    const field = new FlowField(GRID, isBlocked);
    field.recompute(5, 5);

    // (0,5)에서는 뚫린 구멍(cy=0) 쪽으로 방향이 잡혀야 한다 — 최소한 위쪽(y<0) 성분이 있어야 함
    const dir = field.sampleDirection(GRID.originX, GRID.originY + 5 * GRID.tileSize);
    expect(dir.y).toBeLessThan(0);
  });
});
