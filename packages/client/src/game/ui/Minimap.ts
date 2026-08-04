import Phaser from 'phaser';
import type { WorldSnapshot } from '../../net/GameConnection';
import { PANEL_FILL, PANEL_STROKE } from './theme';

const SIZE = 84;
/**
 * 미니맵이 담는 월드 범위(코어 기준 ±px). 맵 전체(±1024)를 다 담으면 점이 뭉쳐서
 * 아무것도 안 보인다 — 자원 군집(최대 350)과 몬스터 스폰 반경(300)이 들어오는 정도로 자른다.
 */
const WORLD_RANGE = 420;

const CORE_COLOR = 0x7f8fa6;
const SELF_COLOR = 0x6fd08c;
const ALLY_COLOR = 0xcfd6e4;
const MONSTER_COLOR = 0xd9756b;
const RESOURCE_COLOR = 0x5b8c4a;
const BUILDING_COLOR = 0xb08a5c;

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
