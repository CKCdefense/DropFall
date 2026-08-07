import { fbm, hashNoise } from './noise';

/**
 * 바닥 지형.
 *
 * **타일셋 배치는 assets/_generators/tiles_terrain.lua와 짝을 맞춘 값이다.**
 * 한쪽만 바꾸면 엉뚱한 타일이 깔린다. 생성기 주석에 같은 표가 들어 있다.
 *
 * 그리는 방식은 "겹쳐 깔기"다. grass를 바닥에 꽉 채우고 그 위에 dirt → sand → stone을
 * 얹는다. 각 지형 타일은 바깥쪽이 투명해서 아래 지형이 비쳐 보이므로, 지형 쌍마다
 * 전이 타일을 만들 필요가 없다(그러면 종류의 제곱으로 늘어난다).
 */

export const TERRAIN_KINDS = ['grass', 'dirt', 'sand', 'stone'] as const;
export type TerrainKind = (typeof TERRAIN_KINDS)[number];

/** 바닥에 꽉 채우는 지형. 나머지는 이 위에 얹힌다. */
export const BASE_TERRAIN: TerrainKind = 'grass';

/** 겹쳐 그리는 순서. 뒤에 오는 것이 위에 깔린다. */
export const OVERLAY_TERRAINS: TerrainKind[] = ['dirt', 'sand', 'stone'];

/** 지형 하나가 차지하는 타일 수: 코너 마스크 16 + 꽉 찬 타일 변형 4 */
export const TILES_PER_TERRAIN = 20;
export const TERRAIN_MASK_COUNT = 16;
export const TERRAIN_FULL_VARIANTS = 4;

/** 타일셋 이미지 격자. build-atlas가 이 값으로 시트를 뽑는다. */
export const TILESET_COLUMNS = 20;
export const TILESET_MARGIN = 1;
export const TILESET_SPACING = 1;

/** 꽉 찬 타일로 쓸 수 있는 로컬 번호들: 마스크 15 + 변형 16~19 */
const FULL_TILE_LOCALS = [
  TERRAIN_MASK_COUNT - 1,
  ...Array.from({ length: TERRAIN_FULL_VARIANTS }, (_, i) => TERRAIN_MASK_COUNT + i),
];

/**
 * 지형 + 로컬 번호 → 타일셋 안의 타일 번호.
 * Phaser Tilemap은 0을 "빈 칸"으로 쓰기 때문에 실제로 넘길 때는 +1 해야 한다(FIRST_GID).
 */
export function terrainTileIndex(kind: TerrainKind, local: number): number {
  return TERRAIN_KINDS.indexOf(kind) * TILES_PER_TERRAIN + local;
}

/**
 * 지형별 노이즈 파라미터.
 *  - scale: 작을수록 덩어리가 크다
 *  - threshold: 높을수록 드물게 나온다
 *  - salt: 지형끼리 같은 모양이 나오지 않게 시드를 어긋내는 값
 */
const FIELDS: Record<string, { scale: number; threshold: number; salt: number }> = {
  // 흙은 넓게 깔린 길처럼 보이도록 덩어리를 크게, 자주 나오게 둔다.
  dirt: { scale: 0.045, threshold: 0.54, salt: 23 },
  // 사막은 4종 중 유일하게 밝아서 넓으면 화면이 붕 뜬다. 임계값을 높여 드문드문 낸다.
  sand: { scale: 0.03, threshold: 0.62, salt: 11 },
  // 암반은 작고 단단한 덩어리로.
  stone: { scale: 0.06, threshold: 0.66, salt: 37 },
};

/**
 * 지형이 이 **꼭짓점**에 있는지.
 *
 * 타일 중심이 아니라 꼭짓점에 정의하는 게 핵심이다. 이웃한 두 타일은 맞닿은 변의 꼭짓점
 * 두 개를 공유하므로, 각자 자기 네 꼭짓점만 보고 타일을 골라도 경계가 저절로 이어진다.
 */
export function hasTerrainAtVertex(
  kind: TerrainKind,
  vx: number,
  vy: number,
  seed: number,
): boolean {
  const field = FIELDS[kind];
  if (!field) return false;

  // 옥타브 2 — 3으로 하면 고주파가 꼭짓점 on/off를 자주 뒤집어서 경계가 계단처럼
  // 들쭉날쭉해진다. 낮출수록 해안선이 완만해진다(대신 세부 굴곡이 줄어든다).
  return fbm(vx * field.scale, vy * field.scale, seed + field.salt, 2) > field.threshold;
}

/**
 * 타일 한 칸을 둘러싼 네 꼭짓점의 조합(0~15).
 * 비트: 1=북서, 2=북동, 4=남동, 8=남서 — 생성기의 비트 순서와 같아야 한다.
 */
export function terrainCornerMask(
  kind: TerrainKind,
  cx: number,
  cy: number,
  seed: number,
): number {
  const nw = hasTerrainAtVertex(kind, cx, cy, seed) ? 1 : 0;
  const ne = hasTerrainAtVertex(kind, cx + 1, cy, seed) ? 2 : 0;
  const se = hasTerrainAtVertex(kind, cx + 1, cy + 1, seed) ? 4 : 0;
  const sw = hasTerrainAtVertex(kind, cx, cy + 1, seed) ? 8 : 0;

  return nw | ne | se | sw;
}

/**
 * 꽉 찬 칸에 쓸 변형을 고른다. 전부 같은 타일을 깔면 격자무늬가 눈에 띈다.
 * 좌표로 결정하므로 다시 계산해도 같은 무늬가 나온다.
 */
export function fullTileLocal(cx: number, cy: number, seed: number): number {
  // 부드러운 노이즈(fbm)로 고르면 이웃 칸이 같은 변형을 골라 무늬 반복이 눈에 띈다.
  // 칸마다 독립적인 해시라야 옆 칸과 다른 변형이 섞인다.
  const pick = Math.floor(hashNoise(cx, cy, seed + 991) * FULL_TILE_LOCALS.length);
  return FULL_TILE_LOCALS[Math.min(pick, FULL_TILE_LOCALS.length - 1)];
}

/**
 * 한 칸에 깔 타일 번호. 지형이 전혀 없으면 null(그 레이어는 비운다).
 * 바닥 지형(grass)은 마스크를 보지 않고 항상 꽉 채운다.
 */
export function terrainTileAt(
  kind: TerrainKind,
  cx: number,
  cy: number,
  seed: number,
): number | null {
  if (kind === BASE_TERRAIN) return terrainTileIndex(kind, fullTileLocal(cx, cy, seed));

  const mask = terrainCornerMask(kind, cx, cy, seed);
  if (mask === 0) return null;
  if (mask === TERRAIN_MASK_COUNT - 1) {
    return terrainTileIndex(kind, fullTileLocal(cx, cy, seed + TERRAIN_KINDS.indexOf(kind)));
  }

  return terrainTileIndex(kind, mask);
}

// ---------------------------------------------------------------- 장식 타일

/** 장식 타일이 시작되는 번호. 생성기(tiles_terrain.lua)의 배치와 짝을 맞춘 값이다. */
export const DECO_TILE_START = TERRAIN_KINDS.length * TILES_PER_TERRAIN;
/** 지형당 장식 변형 수 */
export const DECO_PER_TERRAIN = 4;

/**
 * 지형별 장식 밀도(칸당 확률). 낮게 유지한다 — 장식은 양념이지 주인공이 아니고,
 * 많아지면 몬스터·아이템 같은 진짜 정보가 묻힌다.
 */
const DECO_DENSITY: Record<TerrainKind, number> = {
  grass: 0.05,
  dirt: 0.055,
  sand: 0.04,
  stone: 0.05,
};

/**
 * 이 칸을 완전히 덮은 최상위 지형. 경계 칸이면 null.
 *
 * 장식은 경계에 놓지 않는다 — 두 지형에 걸친 꽃은 어색하고, 경계는 이미 테두리
 * 음영으로 시각적 정보가 많다.
 */
export function topFullTerrainAt(cx: number, cy: number, seed: number): TerrainKind | null {
  let top: TerrainKind = BASE_TERRAIN;

  for (const kind of OVERLAY_TERRAINS) {
    const mask = terrainCornerMask(kind, cx, cy, seed);
    if (mask === TERRAIN_MASK_COUNT - 1) top = kind;
    else if (mask !== 0) return null;
  }

  return top;
}

/**
 * 이 칸에 놓을 장식 타일 번호. 없으면 null.
 * 지형과 마찬가지로 좌표+시드에서 결정된다 — 모든 플레이어가 같은 꽃을 본다.
 */
export function decorationTileAt(cx: number, cy: number, seed: number): number | null {
  const top = topFullTerrainAt(cx, cy, seed);
  if (!top) return null;

  if (hashNoise(cx, cy, seed + 5077) >= DECO_DENSITY[top]) return null;

  const variant = Math.floor(hashNoise(cx, cy, seed + 6011) * DECO_PER_TERRAIN);
  return (
    DECO_TILE_START +
    TERRAIN_KINDS.indexOf(top) * DECO_PER_TERRAIN +
    Math.min(variant, DECO_PER_TERRAIN - 1)
  );
}

// ---------------------------------------------------------------- 포장 타일 (코어 건축 구역)

/** 포장 타일이 시작되는 번호(장식 뒤). 생성기(tiles_terrain.lua)의 배치와 짝을 맞춘 값이다. */
export const PAVEMENT_TILE_START = DECO_TILE_START + 16;

/**
 * 건축 가능 반경 안 포장의 꼭짓점 판정. 지형 노이즈 대신 **원 안인지**만 본다 —
 * 코어 업그레이드로 반경이 변해도 같은 함수로 다시 그리면 된다.
 *
 * 지형과 같은 코너 마스크 방식이라 모서리가 마스크 타일로 깔끔하게 꺾인다. 꼭짓점
 * 좌표는 월드 좌표(px)로 바꿔서 잰다 — 반경도 px 단위(getBuildRadius)라서다.
 */
function hasPavementAtVertex(vx: number, vy: number, radiusPx: number, mapOriginPx: number): boolean {
  const worldX = mapOriginPx + vx * 16;
  const worldY = mapOriginPx + vy * 16;
  // 구역은 정사각형(변의 절반 = radiusPx)이다 — 건축 판정(placeBuilding)과 같은
  // 체비쇼프 거리를 써야 포장 경계가 곧 건축 가능 경계가 된다.
  return Math.max(Math.abs(worldX), Math.abs(worldY)) <= radiusPx;
}

/**
 * 한 칸에 깔 포장 타일 번호. 반경 밖이면 null(그 칸은 비운다).
 * 시그니처가 terrainTileAt과 같은 모양이라 TerrainLayer가 같은 흐름으로 쓴다.
 */
export function pavementTileAt(
  cx: number,
  cy: number,
  radiusPx: number,
  seed: number,
  mapOriginPx: number,
): number | null {
  const nw = hasPavementAtVertex(cx, cy, radiusPx, mapOriginPx) ? 1 : 0;
  const ne = hasPavementAtVertex(cx + 1, cy, radiusPx, mapOriginPx) ? 2 : 0;
  const se = hasPavementAtVertex(cx + 1, cy + 1, radiusPx, mapOriginPx) ? 4 : 0;
  const sw = hasPavementAtVertex(cx, cy + 1, radiusPx, mapOriginPx) ? 8 : 0;
  const mask = nw | ne | se | sw;

  if (mask === 0) return null;
  if (mask === TERRAIN_MASK_COUNT - 1) {
    // 꽉 찬 칸은 지형과 같은 변형 뽑기를 재사용한다(로컬 15~19 배치가 같다).
    return PAVEMENT_TILE_START + fullTileLocal(cx, cy, seed + 4177);
  }
  return PAVEMENT_TILE_START + mask;
}

// ---------------------------------------------------------------- 미니맵

/**
 * 미니맵 한 칸의 지형 종류. `topFullTerrainAt`과 달리 **경계 칸에서도 반드시 하나를
 * 돌려준다** — 미니맵은 한 칸이 1px이라 "경계"라는 중간 상태를 그릴 자리가 없다.
 *
 * 네 꼭짓점을 보는 대신 칸의 좌상단 꼭짓점 **한 점만** 본다. 그래서 경계가 반칸씩
 * 걸치지 않고 칸 단위로 딱 떨어진다 — 축소된 지도에서는 이 편이 지형 덩어리를
 * 읽기 쉽다(요청한 "미니멀라이즈된 경계"가 이것이다).
 *
 * 겹쳐 깔린 순서의 역순으로 훑어 **맨 위 지형**을 고른다(화면에 보이는 것과 같다).
 */
export function minimapTerrainAt(cx: number, cy: number, seed: number): TerrainKind {
  for (let i = OVERLAY_TERRAINS.length - 1; i >= 0; i -= 1) {
    const kind = OVERLAY_TERRAINS[i]!;
    if (hasTerrainAtVertex(kind, cx, cy, seed)) return kind;
  }
  return BASE_TERRAIN;
}

/**
 * 미니맵에 쓰는 지형 색. 타일 아트(tiles_terrain.lua)의 바탕색을 그대로 쓰되
 * 한 단계 어둡게 눌렀다 — 지형은 배경이고, 그 위에 찍히는 엔티티 점이 주인공이라
 * 배경이 밝으면 점이 묻힌다.
 */
export const MINIMAP_TERRAIN_COLOR: Record<TerrainKind, number> = {
  grass: 0x2f4429,
  dirt: 0x413124,
  sand: 0x6b5f41,
  stone: 0x434852,
};
