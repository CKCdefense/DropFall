import Phaser from 'phaser';
import {
  MAP_SIZE_TILES,
  TILE_SIZE,
  MINIMAP_TERRAIN_COLOR,
  hashString,
  minimapTerrainAt,
} from '@dropfall/shared';
import type { WorldSnapshot } from '../../net/GameConnection';
import { PANEL_FILL, PANEL_STROKE } from './theme';

const SIZE = 168;

/**
 * 미니맵이 담는 월드 범위(코어 기준 ±px) = **맵 전체**.
 *
 * 예전엔 1050처럼 맵보다 살짝 큰 값을 썼는데, 지형을 깔면서 맵 경계와 정확히
 * 맞췄다 — 미니맵 한 픽셀이 타일 한 칸에 1:1로 대응해야 지형 이미지와 엔티티 점이
 * 어긋나지 않는다. 콜로니 최대 거리(1000)도 이 안에 들어온다.
 */
const WORLD_RANGE = (MAP_SIZE_TILES * TILE_SIZE) / 2;

const CORE_COLOR = 0x7f8fa6;
const SELF_COLOR = 0x6fd08c;
const ALLY_COLOR = 0xcfd6e4;
const MONSTER_COLOR = 0xd9756b;
const RESOURCE_COLOR = 0x5b8c4a;
const BUILDING_COLOR = 0xb08a5c;
const COLONY_COLOR = 0x7a3fb0;
const COLONY_DESTROYED_COLOR = 0x4a3f52;

/** 지형 이미지를 살짝 죽여 엔티티 점이 위로 뜨게 한다. */
const TERRAIN_ALPHA = 0.9;

/**
 * 우상단 미니맵(와이어프레임 우상단 사각형).
 *
 * **지형은 한 번만 굽고, 엔티티만 매 프레임 다시 그린다.**
 * 지형은 시드에서 결정되는 고정값이라(서버에서 받아올 필요가 없다) 생성 시점에
 * 128×128 캔버스 텍스처로 한 번 구워 두고 늘려서 깐다. 반대로 엔티티는 계속
 * 생겼다 사라지므로 Graphics를 통째로 다시 그리는 편이 스프라이트를 풀링하는
 * 관리 비용보다 싸다.
 */
export class Minimap {
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly terrain: Phaser.GameObjects.Image | null;
  private readonly dots: Phaser.GameObjects.Graphics;
  private left = 0;
  private top = 0;
  private size = SIZE;

  constructor(scene: Phaser.Scene, seedSource: string) {
    this.frame = scene.add
      .rectangle(0, 0, SIZE, SIZE, PANEL_FILL, 0.86)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);

    const key = bakeTerrainTexture(scene, seedSource);
    this.terrain = key
      ? scene.add.image(0, 0, key).setOrigin(0, 0).setAlpha(TERRAIN_ALPHA)
      : null;

    // 테두리·지형 다음에 만들어야 점이 그 위에 그려진다.
    this.dots = scene.add.graphics();
  }

  /** right가 오른쪽 경계, top이 위쪽 경계다(우상단 정렬). */
  layout(right: number, top: number, scale: number): void {
    this.size = SIZE * scale;
    this.left = right - this.size;
    this.top = top;
    this.frame.setSize(this.size, this.size).setPosition(this.left, this.top);
    // 테두리 안쪽에 딱 맞춘다 — 1px 선 위로 지형이 덮으면 경계가 흐려진다.
    this.terrain?.setDisplaySize(this.size - 2, this.size - 2).setPosition(this.left + 1, this.top + 1);
  }

  update(snapshot: WorldSnapshot, ownSessionId: string): void {
    this.dots.clear();

    // 코어는 월드 원점이자 미니맵 중앙이다.
    const centerX = this.left + this.size / 2;
    const centerY = this.top + this.size / 2;
    this.dots.fillStyle(CORE_COLOR, 1);
    this.dots.fillRect(centerX - 2, centerY - 2, 4, 4);

    this.plot(snapshot.resourceNodes, RESOURCE_COLOR, 1);
    this.plot(snapshot.buildings, BUILDING_COLOR, 1);
    this.plot(
      snapshot.colonies.filter((colony) => !colony.destroyed),
      COLONY_COLOR,
      2,
    );
    this.plot(
      snapshot.colonies.filter((colony) => colony.destroyed),
      COLONY_DESTROYED_COLOR,
      2,
    );
    this.plot(snapshot.monsters, MONSTER_COLOR, 1.5);

    // 플레이어는 마지막에 찍어야 몬스터 무리에 묻히지 않는다.
    for (const player of snapshot.players) {
      const isMe = player.id === ownSessionId;
      this.plot([player], isMe ? SELF_COLOR : ALLY_COLOR, isMe ? 2 : 1.5);
    }
  }

  /** 월드 좌표를 미니맵 안으로 옮겨 점을 찍는다. 범위를 벗어난 것은 그리지 않는다. */
  private plot(entities: { x: number; y: number }[], color: number, radius: number): void {
    this.dots.fillStyle(color, 1);

    for (const entity of entities) {
      if (Math.abs(entity.x) > WORLD_RANGE || Math.abs(entity.y) > WORLD_RANGE) continue;

      const x = this.left + ((entity.x + WORLD_RANGE) / (WORLD_RANGE * 2)) * this.size;
      const y = this.top + ((entity.y + WORLD_RANGE) / (WORLD_RANGE * 2)) * this.size;
      this.dots.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
}

/**
 * 지형을 128×128 캔버스 텍스처로 굽는다(타일 한 칸 = 1픽셀). 같은 시드면 이미 구운
 * 것을 그대로 쓴다 — 씬을 다시 시작해도 다시 굽지 않는다.
 *
 * 텍스처가 아니라 Graphics로 칸마다 사각형을 그리면 16384번의 드로우가 남는데,
 * 이미지 한 장이면 GPU가 한 번에 처리한다.
 */
function bakeTerrainTexture(scene: Phaser.Scene, seedSource: string): string | null {
  const seed = hashString(seedSource);
  const key = `minimap-terrain-${seed}`;
  if (scene.textures.exists(key)) return key;

  const canvas = scene.textures.createCanvas(key, MAP_SIZE_TILES, MAP_SIZE_TILES);
  if (!canvas) return null;

  const ctx = canvas.getContext();
  const image = ctx.createImageData(MAP_SIZE_TILES, MAP_SIZE_TILES);
  const pixels = image.data;

  for (let ty = 0; ty < MAP_SIZE_TILES; ty += 1) {
    for (let tx = 0; tx < MAP_SIZE_TILES; tx += 1) {
      const color = MINIMAP_TERRAIN_COLOR[minimapTerrainAt(tx, ty, seed)];
      const at = (ty * MAP_SIZE_TILES + tx) * 4;
      pixels[at] = (color >> 16) & 0xff;
      pixels[at + 1] = (color >> 8) & 0xff;
      pixels[at + 2] = color & 0xff;
      pixels[at + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  canvas.refresh();
  return key;
}
