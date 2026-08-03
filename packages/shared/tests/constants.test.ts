import { describe, expect, it } from 'vitest';
import {
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
  WORLD_VIEW_HEIGHT,
  WORLD_VIEW_WIDTH,
  computeCameraZoom,
} from '../src/constants';

describe('computeCameraZoom', () => {
  it('기준 시야에 맞는 정수 배율을 고른다', () => {
    expect(computeCameraZoom(WORLD_VIEW_WIDTH * 3, WORLD_VIEW_HEIGHT * 3)).toBe(3);
    expect(computeCameraZoom(WORLD_VIEW_WIDTH * 4, WORLD_VIEW_HEIGHT * 4)).toBe(4);
  });

  it('항상 정수다 — 소수배 확대는 픽셀 크기를 들쭉날쭉하게 만든다', () => {
    // 1195x668 같은 실제 창 크기 (1195/480 = 2.49)
    const zoom = computeCameraZoom(1195, 668);
    expect(Number.isInteger(zoom)).toBe(true);
    expect(zoom).toBe(2);
  });

  it('작은 창에서도 최소 배율 아래로 내려가지 않는다', () => {
    expect(computeCameraZoom(320, 200)).toBe(MIN_CAMERA_ZOOM);
  });

  it('큰 창에서도 상한을 넘지 않는다 — 모니터 크기가 시야 이점이 되면 안 된다', () => {
    expect(computeCameraZoom(7680, 4320)).toBe(MAX_CAMERA_ZOOM);
  });

  it('좁은 쪽 축을 기준으로 맞춘다', () => {
    // 가로는 4배가 들어가지만 세로는 2배까지만 들어간다
    expect(computeCameraZoom(WORLD_VIEW_WIDTH * 4, WORLD_VIEW_HEIGHT * 2)).toBe(2);
  });
});
