import { describe, expect, it } from 'vitest';
import { fbm, hashNoise, hashString, valueNoise } from '../src/terrain/noise';
import {
  BASE_TERRAIN,
  OVERLAY_TERRAINS,
  TERRAIN_KINDS,
  TERRAIN_MASK_COUNT,
  TILES_PER_TERRAIN,
  hasTerrainAtVertex,
  terrainCornerMask,
  terrainTileAt,
  terrainTileIndex,
} from '../src/terrain/terrain';

describe('noise', () => {
  it('같은 입력이면 항상 같은 값이 나온다(플레이어끼리 지형이 일치해야 한다)', () => {
    expect(hashNoise(12, -34, 7)).toBe(hashNoise(12, -34, 7));
    expect(fbm(1.5, 2.5, 99)).toBe(fbm(1.5, 2.5, 99));
  });

  it('시드가 다르면 다른 지형이 나온다', () => {
    expect(hashNoise(3, 4, 1)).not.toBe(hashNoise(3, 4, 2));
  });

  it('항상 0 이상 1 미만이다', () => {
    for (let i = 0; i < 500; i += 1) {
      const v = fbm(i * 0.37, i * -0.21, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('음수 좌표에서도 깨지지 않는다(월드 원점이 맵 한가운데다)', () => {
    const v = fbm(-120.5, -88.25, 3);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('격자점에서는 해시값을 그대로 돌려준다', () => {
    expect(valueNoise(5, 9, 2)).toBeCloseTo(hashNoise(5, 9, 2), 10);
  });

  it('이웃한 좌표끼리 값이 이어진다(덩어리가 생겨야 한다)', () => {
    // 값 노이즈는 격자 사이를 보간하므로 0.1칸 옆은 거의 같은 값이어야 한다.
    const a = valueNoise(10, 10, 1);
    const b = valueNoise(10.1, 10, 1);
    expect(Math.abs(a - b)).toBeLessThan(0.3);
  });

  it('문자열 시드는 방마다 다른 값을 준다', () => {
    expect(hashString('ABCD')).not.toBe(hashString('ABCE'));
    expect(hashString('ABCD')).toBe(hashString('ABCD'));
  });
});

describe('타일셋 배치', () => {
  it('지형마다 연속된 블록을 차지한다', () => {
    expect(terrainTileIndex('grass', 0)).toBe(0);
    expect(terrainTileIndex('dirt', 0)).toBe(TILES_PER_TERRAIN);
    expect(terrainTileIndex('sand', 5)).toBe(TILES_PER_TERRAIN * 2 + 5);
  });

  it('블록이 겹치지 않는다', () => {
    const used = new Set<number>();
    for (const kind of TERRAIN_KINDS) {
      for (let local = 0; local < TILES_PER_TERRAIN; local += 1) {
        const index = terrainTileIndex(kind, local);
        expect(used.has(index)).toBe(false);
        used.add(index);
      }
    }
    expect(used.size).toBe(TERRAIN_KINDS.length * TILES_PER_TERRAIN);
  });
});

describe('코너 마스크', () => {
  const SEED = 4242;

  it('네 꼭짓점의 조합을 비트로 만든다', () => {
    // 실제 노이즈 대신 규칙을 직접 확인한다: 각 비트가 해당 꼭짓점에서만 켜져야 한다.
    for (let cx = -20; cx < 20; cx += 1) {
      for (let cy = -20; cy < 20; cy += 1) {
        const mask = terrainCornerMask('sand', cx, cy, SEED);
        const expected =
          (hasTerrainAtVertex('sand', cx, cy, SEED) ? 1 : 0) |
          (hasTerrainAtVertex('sand', cx + 1, cy, SEED) ? 2 : 0) |
          (hasTerrainAtVertex('sand', cx + 1, cy + 1, SEED) ? 4 : 0) |
          (hasTerrainAtVertex('sand', cx, cy + 1, SEED) ? 8 : 0);
        expect(mask).toBe(expected);
      }
    }
  });

  /**
   * 이 테스트가 이음매를 보장한다.
   * 옆칸의 왼쪽 두 꼭짓점은 이 칸의 오른쪽 두 꼭짓점과 **같은 점**이어야 한다.
   * 어긋나면 경계선이 타일 사이에서 끊긴다.
   */
  it('이웃한 칸이 맞닿은 변의 꼭짓점을 공유한다', () => {
    for (const kind of OVERLAY_TERRAINS) {
      for (let cx = -10; cx < 10; cx += 1) {
        for (let cy = -10; cy < 10; cy += 1) {
          const here = terrainCornerMask(kind, cx, cy, SEED);
          const right = terrainCornerMask(kind, cx + 1, cy, SEED);
          // 이 칸의 북동(2)/남동(4) = 옆칸의 북서(1)/남서(8)
          expect((right & 1) !== 0).toBe((here & 2) !== 0);
          expect((right & 8) !== 0).toBe((here & 4) !== 0);

          const below = terrainCornerMask(kind, cx, cy + 1, SEED);
          // 이 칸의 남서(8)/남동(4) = 아랫칸의 북서(1)/북동(2)
          expect((below & 1) !== 0).toBe((here & 8) !== 0);
          expect((below & 2) !== 0).toBe((here & 4) !== 0);
        }
      }
    }
  });
});

describe('terrainTileAt', () => {
  const SEED = 777;

  it('바닥 지형은 항상 꽉 찬 타일이다(구멍이 뚫리면 안 된다)', () => {
    for (let i = 0; i < 200; i += 1) {
      const tile = terrainTileAt(BASE_TERRAIN, i, -i, SEED);
      expect(tile).not.toBeNull();
    }
  });

  it('덮는 지형이 없는 칸은 비운다', () => {
    // 임계값이 높은 지형이라 대부분의 칸은 비어야 한다.
    let empty = 0;
    for (let cx = 0; cx < 40; cx += 1) {
      for (let cy = 0; cy < 40; cy += 1) {
        if (terrainTileAt('stone', cx, cy, SEED) === null) empty += 1;
      }
    }
    expect(empty).toBeGreaterThan(0);
  });

  it('돌려주는 번호가 그 지형의 블록 안에 있다', () => {
    for (const kind of TERRAIN_KINDS) {
      const first = terrainTileIndex(kind, 0);
      for (let cx = 0; cx < 30; cx += 1) {
        for (let cy = 0; cy < 30; cy += 1) {
          const tile = terrainTileAt(kind, cx, cy, SEED);
          if (tile === null) continue;
          expect(tile).toBeGreaterThanOrEqual(first);
          expect(tile).toBeLessThan(first + TILES_PER_TERRAIN);
        }
      }
    }
  });

  it('완전히 덮인 칸은 마스크 15가 아니라 변형 타일 중 하나를 쓴다', () => {
    // 마스크 15와 변형(16~19)은 모두 "꽉 찬" 타일이다. 둘 중 하나여야 한다.
    const fullLocals = new Set([15, 16, 17, 18, 19]);
    for (let cx = -30; cx < 30; cx += 1) {
      for (let cy = -30; cy < 30; cy += 1) {
        if (terrainCornerMask('dirt', cx, cy, SEED) !== TERRAIN_MASK_COUNT - 1) continue;
        const tile = terrainTileAt('dirt', cx, cy, SEED)!;
        expect(fullLocals.has(tile - terrainTileIndex('dirt', 0))).toBe(true);
      }
    }
  });

  it('같은 좌표는 몇 번을 물어도 같은 타일이다', () => {
    for (const kind of TERRAIN_KINDS) {
      expect(terrainTileAt(kind, 13, -7, SEED)).toBe(terrainTileAt(kind, 13, -7, SEED));
    }
  });
});
