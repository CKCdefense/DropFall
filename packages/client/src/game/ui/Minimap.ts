import Phaser from 'phaser';
import type { WorldSnapshot } from '../../net/GameConnection';
import { PANEL_FILL, PANEL_STROKE } from './theme';

const SIZE = 84;
/**
 * 미니맵이 담는 월드 범위(코어 기준 ±px). 콜로니/스폰 반경이 잘리지 않을 만큼만
 * 잡는다 — 그보다 넓히면 화면 안쪽(자원 군집 등)이 중앙에 너무 뭉쳐 보인다.
 * 예전엔 420이었는데(자원 군집 350 기준), 콜로니가 훨씬 먼 고정 랜드마크라 이 값
 * 없이는 미니맵에 아예 안 잡혀서 방향을 찾을 수 없었다(docs/backend/35).
 * 콜로니가 사분면별 무작위 위치로 바뀌면서 최대 거리가 900→1000으로 늘어
 * (`coloniesData.spawnRadiusMax`, docs/backend/41) 950으로는 다시 잘릴 수 있어
 * 1050으로 올렸다 — 새 엔티티를 멀리 배치할 때마다 이 값을 같이 확인할 것.
 */
const WORLD_RANGE = 1050;

const CORE_COLOR = 0x7f8fa6;
const SELF_COLOR = 0x6fd08c;
const ALLY_COLOR = 0xcfd6e4;
const MONSTER_COLOR = 0xd9756b;
const RESOURCE_COLOR = 0x5b8c4a;
const BUILDING_COLOR = 0xb08a5c;
const COLONY_COLOR = 0x7a3fb0;
const COLONY_DESTROYED_COLOR = 0x4a3f52;

/**
 * 우상단 미니맵(와이어프레임 우상단 사각형).
 *
 * 매 프레임 Graphics를 통째로 다시 그린다. 엔티티가 수백 개 수준이라 점 찍는 비용이
 * 객체를 만들고 재활용하는 관리 비용보다 싸다 — 몬스터가 계속 생겼다 사라지므로
 * 스프라이트 풀을 두면 오히려 복잡해진다.
 */
export class Minimap {
  private readonly frame: Phaser.GameObjects.Rectangle;
  private readonly dots: Phaser.GameObjects.Graphics;
  private left = 0;
  private top = 0;
  private size = SIZE;

  constructor(scene: Phaser.Scene) {
    this.frame = scene.add
      .rectangle(0, 0, SIZE, SIZE, PANEL_FILL, 0.86)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
    this.dots = scene.add.graphics();
  }

  /** right가 오른쪽 경계, top이 위쪽 경계다(우상단 정렬). */
  layout(right: number, top: number, scale: number): void {
    this.size = SIZE * scale;
    this.left = right - this.size;
    this.top = top;
    this.frame.setSize(this.size, this.size).setPosition(this.left, this.top);
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
