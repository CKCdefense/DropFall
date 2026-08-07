import { MAP_SIZE_TILES, worldToCell } from '../constants';

/**
 * 팀이 밝힌 지역(탐색 안개).
 *
 * **누가 봤든 팀 전체가 공유한다.** 정찰이 팀에 기여하는 행동이 되고, 중도 합류나
 * 재접속한 사람도 지도를 그대로 이어받는다 — 협동 게임에 맞는 선택이다.
 *
 * 칸마다 1비트라 128×128 맵 전체가 **2KB**다. 이 크기면 통째로 스냅샷에 실어도
 * 부담이 없고(Colyseus가 바뀐 바이트만 델타로 보낸다), 클라이언트는 받은 바이트를
 * 그대로 미니맵 마스크에 찍으면 된다 — 양쪽 다 별도 자료구조가 필요 없다.
 */

const CELL_COUNT = MAP_SIZE_TILES * MAP_SIZE_TILES;
export const EXPLORED_BYTE_COUNT = CELL_COUNT / 8;

/**
 * 플레이어 한 명이 밝히는 반경(타일). 화면에 보이는 범위(가로 반폭 15칸, 세로 반폭
 * 8칸)의 중간쯤으로 잡았다 — 화면보다 넓으면 안 가본 곳이 열리고, 좁으면 지나온
 * 자리가 안 열린 채 남는다.
 */
export const REVEAL_RADIUS_TILES = 12;

export class ExploredMap {
  /** 칸 인덱스(ty * 폭 + tx)의 비트. 1이면 밝혀진 곳. */
  private readonly bytes = new Uint8Array(EXPLORED_BYTE_COUNT);

  isExplored(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= MAP_SIZE_TILES || cy >= MAP_SIZE_TILES) return false;
    const index = cy * MAP_SIZE_TILES + cx;
    return (this.bytes[index >> 3]! & (1 << (index & 7))) !== 0;
  }

  /** 이미 밝혀진 칸이면 false. */
  reveal(cx: number, cy: number): boolean {
    if (cx < 0 || cy < 0 || cx >= MAP_SIZE_TILES || cy >= MAP_SIZE_TILES) return false;
    const index = cy * MAP_SIZE_TILES + cx;
    const at = index >> 3;
    const mask = 1 << (index & 7);
    if ((this.bytes[at]! & mask) !== 0) return false;
    this.bytes[at]! |= mask;
    return true;
  }

  /** 월드 좌표 주변을 원형으로 밝힌다. 새로 밝혀진 칸 수를 돌려준다. */
  revealAround(worldX: number, worldY: number, radiusTiles = REVEAL_RADIUS_TILES): number {
    const { cx, cy } = worldToCell(worldX, worldY);
    const radiusSquared = radiusTiles * radiusTiles;
    let revealed = 0;

    for (let dy = -radiusTiles; dy <= radiusTiles; dy += 1) {
      for (let dx = -radiusTiles; dx <= radiusTiles; dx += 1) {
        if (dx * dx + dy * dy > radiusSquared) continue;
        if (this.reveal(cx + dx, cy + dy)) revealed += 1;
      }
    }
    return revealed;
  }

  /**
   * 네트워크로 실어 보낼 바이트열. 복사본이 아니라 내부 버퍼를 그대로 준다 —
   * 매 틱 2KB를 복사할 이유가 없다. 받는 쪽은 읽기만 한다.
   */
  get raw(): Uint8Array {
    return this.bytes;
  }

  /** 서버에서 받은 상태로 덮어쓴다(로컬 모드에는 필요 없지만 대칭을 위해 둔다). */
  load(bytes: ArrayLike<number>): void {
    for (let i = 0; i < EXPLORED_BYTE_COUNT; i += 1) this.bytes[i] = bytes[i] ?? 0;
  }
}
