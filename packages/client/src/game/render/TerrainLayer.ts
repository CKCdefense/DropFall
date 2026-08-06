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
  pavementTileAt,
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

/**
 * 컬링 여유(타일 수). Tilemap은 카메라에 걸리는 칸만 그리는데, 기본 여유가 1칸이라
 * 화면 가장자리 한 줄이 카메라가 움직이는 도중 그려졌다 말았다 한다 — 화면 아래쪽에
 * 실금이 스치듯 나타나는 원인이다. 한 줄 더 그려도 비용은 거의 없다.
 */
const CULL_PADDING_TILES = 3;

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
  /** 코어 건축 구역 포장. 반경이 바뀔 때만 다시 그린다. */
  private courtyard?: Phaser.Tilemaps.TilemapLayer;
  private courtyardRadius = -1;
  private readonly seed: number;

  constructor(scene: Phaser.Scene, seedSource: string) {
    const seed = hashString(seedSource);
    this.seed = seed;

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

    const courtyard = this.map.createBlankLayer('courtyard', tileset);
    if (courtyard) {
      courtyard.setPosition(MAP_ORIGIN, MAP_ORIGIN);
      courtyard.setCullPadding(3, 3);
      // 장식(꽃·자갈)보다 위 — 포장 아래 깔린 들꽃이 비쳐 보이면 어색하다.
      courtyard.setDepth(TERRAIN_DEPTH + 2);
      this.courtyard = courtyard;
      this.layers.push(courtyard);
    }
  }

  /**
   * 코어 건축 가능 반경(px)에 맞춰 포장을 다시 깐다. 스냅샷마다 불러도 되지만 실제
   * 다시 그리는 건 반경이 바뀐 순간뿐이다 — 코어 업그레이드는 게임당 몇 번 안 일어난다.
   *
   * 이전 반경과 새 반경 중 큰 쪽의 사각 범위만 순회한다. 최대 반경(900px ≈ 57칸)이라
   * 최악에도 1만여 칸 — 업그레이드 순간 한 번이면 체감되지 않는다.
   */
  setBuildRadius(radiusPx: number): void {
    if (!this.courtyard || radiusPx === this.courtyardRadius) return;

    const span = Math.max(radiusPx, this.courtyardRadius);
    this.courtyardRadius = radiusPx;

    const center = MAP_SIZE_TILES / 2;
    const reach = Math.min(center, Math.ceil(span / TILE_SIZE) + 1);
    for (let ty = center - reach; ty < center + reach; ty += 1) {
      for (let tx = center - reach; tx < center + reach; tx += 1) {
        const tile = pavementTileAt(tx, ty, radiusPx, this.seed, MAP_ORIGIN);
        this.courtyard.putTileAt(tile === null ? EMPTY_TILE : tile + FIRST_GID, tx, ty);
      }
    }
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
    layer.setCullPadding(CULL_PADDING_TILES, CULL_PADDING_TILES);
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
    layer.setCullPadding(CULL_PADDING_TILES, CULL_PADDING_TILES);
    layer.setDepth(TERRAIN_DEPTH);
    return layer;
  }

  destroy(): void {
    for (const layer of this.layers) layer.destroy();
    this.layers.length = 0;
    this.map.destroy();
  }
}
