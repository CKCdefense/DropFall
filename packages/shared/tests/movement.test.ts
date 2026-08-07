import { describe, expect, it } from 'vitest';
import { normalizeMoveVector, stepPosition } from '../src/sim/movement';

describe('normalizeMoveVector', () => {
  it('범위를 벗어난 값을 -1~1로 clamp한다', () => {
    expect(normalizeMoveVector(999, 0)).toEqual({ moveX: 1, moveY: 0 });
  });

  it('대각선으로 범위를 벗어나도 clamp 후 정규화까지 적용된다', () => {
    const { moveX, moveY } = normalizeMoveVector(999, -999);
    expect(Math.hypot(moveX, moveY)).toBeCloseTo(1, 5);
  });

  it('대각선 입력의 길이를 1로 정규화한다', () => {
    const { moveX, moveY } = normalizeMoveVector(1, 1);
    expect(Math.hypot(moveX, moveY)).toBeCloseTo(1, 5);
  });

  it('길이가 1 이하인 입력은 그대로 둔다', () => {
    expect(normalizeMoveVector(0.5, 0)).toEqual({ moveX: 0.5, moveY: 0 });
  });
});

describe('stepPosition', () => {
  it('이동 벡터와 dt에 비례해 위치를 전진시킨다', () => {
    const result = stepPosition(0, 0, 1, 0, 1);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBe(0);
  });

  it('입력이 0이면 위치가 그대로다', () => {
    expect(stepPosition(5, 5, 0, 0, 1)).toEqual({ x: 5, y: 5 });
  });
});
