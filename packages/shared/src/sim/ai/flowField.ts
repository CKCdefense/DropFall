/**
 * Flow Field 이동 AI (기술명세 §5).
 *
 * 코어 셀에서 BFS로 거리맵을 만들고, 각 셀에 "가장 가까워지는 방향" 벡터를 저장한다.
 * 몬스터는 자기가 선 셀의 벡터만 읽으면 되므로 개체당 조회가 O(1)이다.
 * 재계산(recompute)은 건축물 설치/파괴 같은 이벤트가 있을 때만 호출해야 한다 — 매 틱 호출 금지.
 */

const NEIGHBORS_8 = [
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
];

export interface FlowFieldGrid {
  widthInTiles: number;
  heightInTiles: number;
  tileSize: number;
  /** 그리드 (0,0) 셀의 좌상단 월드 좌표 */
  originX: number;
  originY: number;
}

export type IsBlocked = (cx: number, cy: number) => boolean;

export class FlowField {
  private readonly cost: Int32Array;
  private readonly dirX: Float32Array;
  private readonly dirY: Float32Array;

  constructor(
    private readonly grid: FlowFieldGrid,
    private readonly isBlocked: IsBlocked = () => false,
  ) {
    const size = grid.widthInTiles * grid.heightInTiles;
    this.cost = new Int32Array(size).fill(-1);
    this.dirX = new Float32Array(size);
    this.dirY = new Float32Array(size);
  }

  private index(cx: number, cy: number): number {
    return cy * this.grid.widthInTiles + cx;
  }

  private inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.grid.widthInTiles && cy < this.grid.heightInTiles;
  }

  worldToCell(worldX: number, worldY: number): { cx: number; cy: number } {
    return {
      cx: Math.floor((worldX - this.grid.originX) / this.grid.tileSize),
      cy: Math.floor((worldY - this.grid.originY) / this.grid.tileSize),
    };
  }

  /** targetCx/targetCy(보통 코어 셀)로부터 거리맵과 방향 벡터를 다시 계산한다. */
  recompute(targetCx: number, targetCy: number): void {
    this.cost.fill(-1);
    this.dirX.fill(0);
    this.dirY.fill(0);

    if (!this.inBounds(targetCx, targetCy) || this.isBlocked(targetCx, targetCy)) return;

    const targetIndex = this.index(targetCx, targetCy);
    const queue: number[] = [targetIndex];
    this.cost[targetIndex] = 0;
    let head = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      const cx = current % this.grid.widthInTiles;
      const cy = Math.floor(current / this.grid.widthInTiles);

      for (const { dx, dy } of NEIGHBORS_8) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.inBounds(nx, ny) || this.isBlocked(nx, ny)) continue;

        const nIndex = this.index(nx, ny);
        if (this.cost[nIndex] !== -1) continue;

        this.cost[nIndex] = this.cost[current] + 1;
        queue.push(nIndex);
      }
    }

    // 방향 벡터: 8방향 이웃 중 cost가 가장 낮은 쪽(steepest descent)으로 정한다.
    for (let cy = 0; cy < this.grid.heightInTiles; cy += 1) {
      for (let cx = 0; cx < this.grid.widthInTiles; cx += 1) {
        const index = this.index(cx, cy);
        if (this.cost[index] <= 0) continue; // 도달 불가 또는 목표 셀 자신

        let bestCost = this.cost[index];
        let bestDx = 0;
        let bestDy = 0;

        for (const { dx, dy } of NEIGHBORS_8) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nCost = this.cost[this.index(nx, ny)];
          if (nCost === -1 || nCost >= bestCost) continue;
          bestCost = nCost;
          bestDx = dx;
          bestDy = dy;
        }

        if (bestDx === 0 && bestDy === 0) continue;
        const length = Math.hypot(bestDx, bestDy);
        this.dirX[index] = bestDx / length;
        this.dirY[index] = bestDy / length;
      }
    }
  }

  /** 월드 좌표 기준으로 해당 셀의 이동 방향(단위 벡터)을 읽는다. 도달 불가면 {x:0, y:0}. */
  sampleDirection(worldX: number, worldY: number): { x: number; y: number } {
    const { cx, cy } = this.worldToCell(worldX, worldY);
    if (!this.inBounds(cx, cy)) return { x: 0, y: 0 };

    const index = this.index(cx, cy);
    if (this.cost[index] === -1) return { x: 0, y: 0 };
    return { x: this.dirX[index], y: this.dirY[index] };
  }
}
