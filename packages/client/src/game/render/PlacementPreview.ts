import Phaser from 'phaser';
import { TILE_SIZE, cellCenterWorld, coreDistance, itemOfSlot, worldToCell } from '@dropfall/shared';
import type { PlayerView, WorldSnapshot } from '../../net/GameConnection';

/** 미리보기 사각형은 지형 위·캐릭터 아래. 바닥에 그려진 표시라 캐릭터를 가리면 안 된다. */
const DEPTH = 40;

/** 지을 수 있을 때와 없을 때의 색. 초록/빨강은 이 게임의 다른 UI와 같은 뜻으로 쓴다. */
const OK_COLOR = 0x6fd08c;
const BLOCKED_COLOR = 0xd9756b;
const FILL_ALPHA = 0.16;

/**
 * 건축 아이템을 들었을 때 커서가 가리키는 칸을 비춰 준다.
 *
 * **가능/불가를 색으로 미리 말해 준다.** 서버는 배치를 거절해도 아무것도 돌려주지
 * 않는다(placeBuilding은 void다) — 미리 보여주지 않으면 왜 안 지어지는지 알 방법이
 * 전혀 없다. 판정은 서버(`World.canPlaceBuildingAt`)와 같은 규칙을 스냅샷으로 다시 계산한다.
 * 여기서 통과했는데 서버가 거절하는 경우(같은 틱에 남이 먼저 지었다 등)는 남지만,
 * 그건 미리보기가 틀린 게 아니라 정보가 한 틱 오래된 것이다.
 */
export class PlacementPreview {
  private readonly box: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene) {
    this.box = scene.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, OK_COLOR, FILL_ALPHA)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(1, OK_COLOR)
      .setDepth(DEPTH)
      .setVisible(false);
  }

  /**
   * @param cell 커서가 가리키는 칸. 건축 아이템을 안 들었으면 null을 넘겨 감춘다.
   */
  update(
    cell: { cx: number; cy: number } | null,
    snapshot: WorldSnapshot,
    me: PlayerView | undefined,
  ): void {
    if (!cell || !me) {
      this.box.setVisible(false);
      return;
    }

    const { x, y } = cellCenterWorld(cell.cx, cell.cy);
    const allowed = this.canPlace(cell, x, y, snapshot);

    this.box
      .setVisible(true)
      .setPosition(x, y)
      .setFillStyle(allowed ? OK_COLOR : BLOCKED_COLOR, FILL_ALPHA)
      .setStrokeStyle(1, allowed ? OK_COLOR : BLOCKED_COLOR);
  }

  hide(): void {
    this.box.setVisible(false);
  }

  /** 서버의 canPlaceBuildingAt과 같은 규칙 — 순서까지 맞춰 두면 둘을 나란히 읽기 쉽다. */
  private canPlace(
    cell: { cx: number; cy: number },
    x: number,
    y: number,
    snapshot: WorldSnapshot,
  ): boolean {
    // 건설 가능 구역은 원이 아니라 정사각형이다(격자에 딱 떨어지게).
    if (Math.max(Math.abs(x), Math.abs(y)) > snapshot.status.coreBuildRadius) return false;
    if (coreDistance(x, y) <= TILE_SIZE / 2) return false;

    for (const building of snapshot.buildings) {
      const other = worldToCell(building.x, building.y);
      if (other.cx === cell.cx && other.cy === cell.cy) return false;
    }
    for (const node of snapshot.resourceNodes) {
      const other = worldToCell(node.x, node.y);
      if (other.cx === cell.cx && other.cy === cell.cy) return false;
    }
    // 자기 자신도 포함한다 — 서 있는 자리에 벽을 세워 스스로 갇히면 안 된다.
    for (const player of snapshot.players) {
      const other = worldToCell(player.x, player.y);
      if (other.cx === cell.cx && other.cy === cell.cy) return false;
    }
    return true;
  }
}

/** 지금 손에 든 것이 설치할 수 있는 건축 아이템인가. */
export function holdsBuilding(me: PlayerView | undefined): boolean {
  if (!me) return false;
  return itemOfSlot(me.slots[me.selectedSlot])?.kind === 'building';
}
