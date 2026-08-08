import { describe, expect, it } from 'vitest';
import { normalizeMoveVector, resolvePlayerMove, stepPosition } from '../src/sim/movement';

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

describe('resolvePlayerMove', () => {
  const neverBlocked = () => false;
  const alwaysBlocked = () => true;

  it('막힌 게 없으면 전체 이동(대각선 포함)을 그대로 적용한다', () => {
    const result = resolvePlayerMove(0, 0, 1, 1, 1, 1, neverBlocked);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBeGreaterThan(0);
  });

  it('전체 이동만 막히면 X축 이동으로 폴백한다(축 슬라이딩)', () => {
    const result = resolvePlayerMove(0, 0, 1, 1, 1, 1, (x, y) => y !== 0);
    expect(result.x).toBeGreaterThan(0);
    expect(result.y).toBe(0);
  });

  it('전체·X축이 막히면 Y축 이동으로 폴백한다', () => {
    const result = resolvePlayerMove(0, 0, 1, 1, 1, 1, (x) => x !== 0);
    expect(result.x).toBe(0);
    expect(result.y).toBeGreaterThan(0);
  });

  it('모든 축이 막히면 제자리에 그대로 있는다', () => {
    const result = resolvePlayerMove(3, 4, 1, 1, 1, 1, alwaysBlocked);
    expect(result).toEqual({ x: 3, y: 4 });
  });

  it('speedMultiplier가 이동 거리에 곱해진다', () => {
    const slow = resolvePlayerMove(0, 0, 1, 0, 1, 1, neverBlocked);
    const fast = resolvePlayerMove(0, 0, 1, 0, 1, 2, neverBlocked);
    expect(fast.x).toBeCloseTo(slow.x * 2, 5);
  });
});
