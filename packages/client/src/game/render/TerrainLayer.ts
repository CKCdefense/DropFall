import Phaser from 'phaser';
import {
  BASE_TERRAIN,
  MAP_ORIGIN,
  MAP_SIZE_TILES,
  OVERLAY_TERRAINS,
  TILESET_MARGIN,
  TILESET_SPACING,
  TILE_SIZE,
  decorationTileAt,
  hashString,
  terrainTileAt,
  type TerrainKind,
} from '@dropfall/shared';

export const TILESET_KEY = 'terrain-tileset';
const TILESET_PATH = 'assets/atlas/tiles.png';
const TILESET_NAME = 'terrain';

/** 바닥은 모든 것보다 아래에 그린다. 엔티티는 y값으로 깊이가 잡히므로 충분히 낮춰둔다. */
const TERRAIN_DEPTH = -1000;

/**
 * Phaser Tilemap은 0을 "빈 칸"으로 예약한다. 그래서 타일셋의 첫 타일이 1번이 되도록
 * 밀어서 넣고, 우리 번호에 이 값을 더해 쓴다.
 */
const FIRST_GID = 1;

/** 비어 있는 칸. 아래 지형이 그대로 보인다. */
const EMPTY_TILE = -1;

export function queueTerrainTileset(scene: Phaser.Scene): void {
  const base = import.meta.env.BASE_URL;
  const url = base.endsWith('/') ? `${base}${TILESET_PATH}` : `${base}/${TILESET_PATH}`;
  scene.load.image(TILESET_KEY, url);
}

export function hasTerrainTileset(scene: Phaser.Scene): boolean {
  return scene.textures.exists(TILESET_KEY);
}

/**
 * 바닥 지형을 Phaser Tilemap으로 깐다.
 *
 * **왜 스프라이트를 직접 뿌리지 않나**
 * 맵이 128×128칸이라 한 겹만 해도 16384장이다. 스프라이트로 만들면 화면 밖 타일까지
 * 매 프레임 갱신 대상이 된다. Tilemap은 카메라에 걸리는 칸만 그리도록 내부에서 잘라내므로
 * 맵을 키워도 그리기 비용이 늘지 않는다.
 *
 * **왜 여러 겹인가**
 * 지형 쌍마다 전이 타일을 만들면 종류의 제곱으로 늘어난다. 대신 위 지형의 바깥쪽을
 * 투명하게 뚫어두고 겹쳐 깔면, 아래에 뭐가 있든 상관없어져서 지형당 16장이면 끝난다.
 * (assets/_generators/tiles_terrain.lua 참고)
 */
export class TerrainLayer {
  private readonly map: Phaser.Tilemaps.Tilemap;
  private readonly layers: Phaser.Tilemaps.TilemapLayer[] = [];

  constructor(scene: Phaser.Scene, seedSource: string) {
    const seed = hashString(seedSource);

    this.map = scene.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: MAP_SIZE_TILES,
      height: MAP_SIZE_TILES,
    });

    // 시트에 넣은 여백을 그대로 알려줘야 타일 경계가 어긋나지 않는다(build-atlas의
    // border-padding = margin, shape-padding = spacing).
    const tileset = this.map.addTilesetImage(
      TILESET_NAME,
      TILESET_KEY,
      TILE_SIZE,
      TILE_SIZE,
      TILESET_MARGIN,
      TILESET_SPACING,
      FIRST_GID,
    );
    if (!tileset) throw new Error('지형 타일셋을 등록하지 못했습니다.');

    for (const kind of [BASE_TERRAIN, ...OVERLAY_TERRAINS]) {
      this.layers.push(this.createLayer(kind, tileset, seed));
    }
    this.layers.push(this.createDecorationLayer(tileset, seed));
  }

  /** 꽃·자갈·뼈 같은 소품. 지형 위, 엔티티 아래에 깔린다. */
  private createDecorationLayer(
    tileset: Phaser.Tilemaps.Tileset,
    seed: number,
  ): Phaser.Tilemaps.TilemapLayer {
    const layer = this.map.createBlankLayer('decoration', tileset);
    if (!layer) throw new Error('장식 레이어를 만들지 못했습니다.');

    for (let ty = 0; ty < MAP_SIZE_TILES; ty += 1) {
      for (let tx = 0; tx < MAP_SIZE_TILES; tx += 1) {
        const tile = decorationTileAt(tx, ty, seed);
        layer.putTileAt(tile === null ? EMPTY_TILE : tile + FIRST_GID, tx, ty);
      }
    }

    layer.setPosition(MAP_ORIGIN, MAP_ORIGIN);
    // 지형보다 한 단계 위 — 그래도 모든 엔티티(depth = y)보다는 아래다.
    layer.setDepth(TERRAIN_DEPTH + 1);
    return layer;
  }

  private createLayer(
    kind: TerrainKind,
    tileset: Phaser.Tilemaps.Tileset,
    seed: number,
  ): Phaser.Tilemaps.TilemapLayer {
    const layer = this.map.createBlankLayer(kind, tileset);
    if (!layer) throw new Error(`지형 레이어를 만들지 못했습니다: ${kind}`);

    for (let ty = 0; ty < MAP_SIZE_TILES; ty += 1) {
      for (let tx = 0; tx < MAP_SIZE_TILES; tx += 1) {
        const tile = terrainTileAt(kind, tx, ty, seed);
        layer.putTileAt(tile === null ? EMPTY_TILE : tile + FIRST_GID, tx, ty);
      }
    }

    // 타일맵 좌표는 0부터 시작하지만 월드 원점은 맵 한가운데다 — 시뮬레이션과 같은
    // 좌표계에 놓이도록 통째로 옮긴다.
    layer.setPosition(MAP_ORIGIN, MAP_ORIGIN);
    layer.setDepth(TERRAIN_DEPTH);
    return layer;
  }

  destroy(): void {
    for (const layer of this.layers) layer.destroy();
    this.layers.length = 0;
    this.map.destroy();
  }
}
