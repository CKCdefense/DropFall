/**
 * Flow Field 이동 AI (기술명세 §5).
 *
 * 코어 셀에서 거리맵을 만들고, 각 셀에 "가장 가까워지는 방향" 벡터를 저장한다.
 * 몬스터는 자기가 선 셀의 벡터만 읽으면 되므로 개체당 조회가 O(1)이다.
 * 재계산(recompute)은 건축물 설치/파괴 같은 이벤트가 있을 때만 호출해야 한다 — 매 틱 호출 금지.
 *
 * 거리 계산은 **가중치 다익스트라**를 쓴다(대각선 이동 비용 √2, 직선 이동 비용 1).
 * 예전엔 이동 비용을 전부 1로 두는 단순 BFS를 썼는데, 이러면 대각선 한 칸과 직선 한 칸이
 * 똑같이 취급돼서(체비셰프 거리) 목표까지의 "최단 경로"가 실제 직선이 아니라 "짧은 축을
 * 먼저 대각선으로 따라잡고 긴 축은 직선으로 마저 가는" 꺾인 경로로 계산된다. 장애물이 없는
 * 지금 같은 상황에서 몬스터가 코어를 향해 완만한 대각선이 아니라 산 모양으로 꺾어 걷는
 * 원인이 이거였다(backend/19).
 *
 * 방향 벡터는 **비용 필드의 그라디언트(중앙차분)** 로 구한다. 대각선 가중치를 고쳐도
 * "8방향 이웃 중 비용이 가장 낮은 쪽 하나"를 그대로 방향으로 쓰면 그 방향이 항상 8가지
 * 값 중 하나로 양자화된다 — 개활지에서도 몬스터가 상하좌우/대각선 8방향으로만 걷다가
 * 코어 근처에서 갑자기 축 정렬로 꺾이는 로봇 같은 경로가 나왔다(backend/20). cost가
 * 실제 가중 유클리드 거리에 가깝기 때문에, 그 필드를 미분(그라디언트)하면 임의의
 * 연속각을 낸다 — 목표를 향해 정말 똑바로 걷는다. 부수적으로 이웃 4개(상하좌우)만
 * 보면 돼서 예전 8방향 스캔보다 계산량도 더 적다.
 */

const SQRT2 = Math.SQRT2;
const NEIGHBORS_8 = [
  { dx: -1, dy: -1, weight: SQRT2 },
  { dx: 0, dy: -1, weight: 1 },
  { dx: 1, dy: -1, weight: SQRT2 },
  { dx: -1, dy: 0, weight: 1 },
  { dx: 1, dy: 0, weight: 1 },
  { dx: -1, dy: 1, weight: SQRT2 },
  { dx: 0, dy: 1, weight: 1 },
  { dx: 1, dy: 1, weight: SQRT2 },
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

/**
 * 한 축의 그라디언트를 중앙차분으로 근사한다. 두 이웃 다 유효하면 중앙차분,
 * 한쪽만 유효하면 그쪽으로 한쪽차분, 둘 다 없으면(고립 셀) 0(그 축은 평평하다고 본다).
 * 여기서 "유효"는 도달 가능(cost !== -1)하다는 뜻 — 범위 밖이든 벽으로 막혔든
 * Dijkstra가 못 지나간 이웃은 전부 cost가 -1이라 이 판정 하나로 같이 걸러진다.
 */
function gradientComponent(here: number, minus: number, plus: number): number {
  const minusValid = minus !== -1;
  const plusValid = plus !== -1;
  if (minusValid && plusValid) return (plus - minus) / 2;
  if (plusValid) return plus - here;
  if (minusValid) return here - minus;
  return 0;
}

/**
 * 이진 최소 힙. 다익스트라의 "아직 확정 안 된 노드 중 가장 가까운 것부터 꺼내기"에 쓴다.
 * 같은 노드가 더 낮은 비용으로 여러 번 들어올 수 있어서(지연 삭제), pop 쪽에서
 * "이미 그보다 낮은 비용으로 확정된 항목"을 걸러낸다 — decrease-key를 직접 구현하는
 * 것보다 간단하고, 이 규모(최대 128×128칸)에서는 성능 차이가 없다.
 */
class MinHeap {
  private readonly cost: number[] = [];
  private readonly index: number[] = [];

  get size(): number {
    return this.cost.length;
  }

  push(cost: number, index: number): void {
    this.cost.push(cost);
    this.index.push(index);
    this.bubbleUp(this.cost.length - 1);
  }

  /** 가장 비용이 낮은 항목을 꺼낸다. 비어 있으면 undefined. */
  pop(): { cost: number; index: number } | undefined {
    const size = this.cost.length;
    if (size === 0) return undefined;

    const topCost = this.cost[0];
    const topIndex = this.index[0];
    const lastCost = this.cost.pop() as number;
    const lastIndex = this.index.pop() as number;

    if (this.cost.length > 0) {
      this.cost[0] = lastCost;
      this.index[0] = lastIndex;
      this.bubbleDown(0);
    }

    return { cost: topCost, index: topIndex };
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cost[parent] <= this.cost[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const size = this.cost.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < size && this.cost[left] < this.cost[smallest]) smallest = left;
      if (right < size && this.cost[right] < this.cost[smallest]) smallest = right;
      if (smallest === i) break;
      this.swap(smallest, i);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    [this.cost[a], this.cost[b]] = [this.cost[b], this.cost[a]];
    [this.index[a], this.index[b]] = [this.index[b], this.index[a]];
  }
}

export class FlowField {
  /**
   * 목표까지의 가중 거리. 도달 불가는 -1.
   *
   * Float32Array가 아니라 Float64Array를 쓴다 — 다익스트라 힙에 넣는 비용(nCost)은
   * 배정밀도(double) 그대로인데, 이걸 Float32에 저장하면 미세하게 반올림된다.
   * 그러면 힙에서 같은 노드를 꺼낼 때 지연 삭제 검사(top.cost > this.cost[index])가
   * "원래 값 > 반올림된 값"이 되어 **최초의 정상 항목조차 스스로보다 낮은 값으로
   * 오판해 건너뛰는** 버그가 생긴다 — 그 노드가 영영 확장되지 않아 하류 셀들이
   * 최적 경로를 못 찾거나(대각선 인접 셀이 원거리 우회로 도달) 아예 도달 불가로
   * 남는다(코너 셀). 정밀도를 맞추면 이 문제가 사라진다.
   */
  private readonly cost: Float64Array;
  private readonly dirX: Float32Array;
  private readonly dirY: Float32Array;
  /**
   * 그리드 전체에 막힌 셀이 하나도 없으면(지금 이 게임처럼 건축물 시스템이 아직 없어
   * `isBlocked`가 항상 false인 상태) `hasLineOfSight`가 매번 셀을 순회할 필요조차
   * 없다 — recompute() 때 한 번만 훑어서 캐싱해 둔다. recompute()는 건축물 설치/파괴
   * 같은 드문 이벤트에만 불리니 이 스캔 비용은 무시할 수준이다.
   */
  private hasObstacles = false;

  constructor(
    private readonly grid: FlowFieldGrid,
    private readonly isBlocked: IsBlocked = () => false,
  ) {
    const size = grid.widthInTiles * grid.heightInTiles;
    this.cost = new Float64Array(size).fill(-1);
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

    this.hasObstacles = false;
    outer: for (let cy = 0; cy < this.grid.heightInTiles; cy += 1) {
      for (let cx = 0; cx < this.grid.widthInTiles; cx += 1) {
        if (this.isBlocked(cx, cy)) {
          this.hasObstacles = true;
          break outer;
        }
      }
    }

    if (!this.inBounds(targetCx, targetCy) || this.isBlocked(targetCx, targetCy)) return;

    const targetIndex = this.index(targetCx, targetCy);
    this.cost[targetIndex] = 0;

    const heap = new MinHeap();
    heap.push(0, targetIndex);

    while (heap.size > 0) {
      const top = heap.pop();
      if (!top) break;

      // 지연 삭제: 이 항목을 넣은 뒤 더 짧은 경로로 이미 확정됐으면 건너뛴다.
      if (top.cost > this.cost[top.index]) continue;

      const cx = top.index % this.grid.widthInTiles;
      const cy = Math.floor(top.index / this.grid.widthInTiles);

      for (const { dx, dy, weight } of NEIGHBORS_8) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.inBounds(nx, ny) || this.isBlocked(nx, ny)) continue;

        const nIndex = this.index(nx, ny);
        const nCost = top.cost + weight;
        if (this.cost[nIndex] !== -1 && nCost >= this.cost[nIndex]) continue;

        this.cost[nIndex] = nCost;
        heap.push(nCost, nIndex);
      }
    }

    // 방향 벡터: 비용(cost) 필드의 그라디언트를 중앙차분으로 구해서, 그 반대 방향(비용이
    // 줄어드는 쪽)으로 정한다. 예전엔 "8방향 이웃 중 비용이 가장 낮은 쪽 하나"를 그대로
    // 방향으로 썼는데, 이러면 셀마다 방향이 반드시 8가지 값 중 하나로 양자화된다 —
    // 대각선 가중치(backend/19)를 고쳐서 비용 자체는 정확해졌어도, 방향은 여전히 "대각선
    // 이동 쭉 하다가 축에 걸리면 직선으로 꺾는" 로봇 같은 경로로만 나왔다(개활지에서
    // 몬스터가 상하좌우/대각선 8방향으로만 걷고, 코어 근처에서 갑자기 축 정렬로
    // 꺾이는 형태). cost가 이제 실제 가중 유클리드 거리에 가깝기 때문에, 그 필드의
    // 그라디언트는 개활지에서 임의의 연속각을 낸다 — 목표를 향해 정말 똑바로 걷는다.
    // 계산량도 이웃 4개(상하좌우)면 충분해서 예전 8방향 스캔보다 오히려 적다.
    for (let cy = 0; cy < this.grid.heightInTiles; cy += 1) {
      for (let cx = 0; cx < this.grid.widthInTiles; cx += 1) {
        const index = this.index(cx, cy);
        const here = this.cost[index];
        if (here <= 0) continue; // 도달 불가 또는 목표 셀 자신

        const left = this.costAt(cx - 1, cy);
        const right = this.costAt(cx + 1, cy);
        const up = this.costAt(cx, cy - 1);
        const down = this.costAt(cx, cy + 1);

        const gx = gradientComponent(here, left, right);
        const gy = gradientComponent(here, up, down);
        if (gx === 0 && gy === 0) continue; // 사방이 막혀 그라디언트를 못 구함

        const length = Math.hypot(gx, gy);
        this.dirX[index] = -gx / length;
        this.dirY[index] = -gy / length;
      }
    }
  }

  /** 범위 밖이면 -1(= 도달 불가 취급)로 취급하는 cost 조회. 그라디언트 경계 처리용. */
  private costAt(cx: number, cy: number): number {
    if (!this.inBounds(cx, cy)) return -1;
    return this.cost[this.index(cx, cy)];
  }

  /** 월드 좌표 기준으로 해당 셀의 이동 방향(단위 벡터)을 읽는다. 도달 불가면 {x:0, y:0}. */
  sampleDirection(worldX: number, worldY: number): { x: number; y: number } {
    const { cx, cy } = this.worldToCell(worldX, worldY);
    if (!this.inBounds(cx, cy)) return { x: 0, y: 0 };

    const index = this.index(cx, cy);
    if (this.cost[index] === -1) return { x: 0, y: 0 };
    return { x: this.dirX[index], y: this.dirY[index] };
  }

  /**
   * from→to 사이에 막힌 셀이 하나도 없으면 true. Flow Field는 그리드 8방향으로만 방향을
   * 낼 수 있어서(옥타일 거리라 그라디언트조차 유한한 각도로만 나뉜다), 실제로 피할
   * 장애물이 없는 구간에선 이 결과로 "목표를 향한 진짜 연속각(직선)"을 대신 쓰는 게
   * 훨씬 자연스럽다 — 장애물이 있는 구간에서만 Flow Field 방향으로 우회한다.
   *
   * 그리드 전체에 막힌 셀이 없으면(`hasObstacles`) 순회 자체를 생략한다. 있으면
   * 반 타일 간격으로 선분을 샘플링해서 지나치는 모든 셀을 확인한다 — 완벽한 격자
   * 순회(DDA)보다 살짝 더 많이 검사하지만 훨씬 단순하고, 반 타일보다 촘촘하니 어떤
   * 셀도 건너뛰지 않는다(다만 선분이 셀 모서리를 아주 살짝 스치기만 하는 극단적인
   * 경우는 놓칠 수 있다 — 실시간 게임에서는 무시할 만한 오차다).
   */
  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    if (!this.hasObstacles) return true;

    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) {
      const { cx, cy } = this.worldToCell(fromX, fromY);
      return !this.isBlocked(cx, cy);
    }

    const stepCount = Math.ceil(distance / (this.grid.tileSize / 2));
    for (let i = 0; i <= stepCount; i += 1) {
      const t = i / stepCount;
      const { cx, cy } = this.worldToCell(fromX + dx * t, fromY + dy * t);
      if (this.isBlocked(cx, cy)) return false;
    }

    return true;
  }
}
