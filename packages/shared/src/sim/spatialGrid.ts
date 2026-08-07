/**
 * 균일 격자 기반 공간 분할. "이 좌표 주변에 뭐가 있나"를 물으면 정확한 답이 아니라
 * **후보 집합**(그 반경이 걸치는 칸들에 들어있는 id)을 돌려준다 — 최종 원-원 판정은
 * 호출자가 circlesOverlap 등으로 마저 해야 한다. 격자는 "전체를 다 볼 필요 없게"
 * 후보를 좁히는 용도지, 그 자체로 정확한 충돌 판정 결과는 아니다.
 *
 * 왜 필요한가: `computeSeparation`/`projectileHitsMonster` 등이 몬스터 수만큼(또는
 * 투사체×몬스터만큼) 매 틱 전체 순회를 하면 개체 수의 제곱으로 무거워진다
 * (docs/backend/45-work-report-monster-spatial-grid.md). 격자로 좁히면 실질적으로
 * O(n)에 가까워진다.
 *
 * 몬스터가 계속 움직이므로 매 틱 다시 만드는 대신, 호출자(World)가 몬스터 위치가
 * 바뀔 때마다 `remove`+`insert`(또는 `updateEntry`)로 살아있는 상태를 유지한다 —
 * 매 틱 O(M) 재구축보다 싸고, 무엇보다 "이번 틱 안에서 이미 이동한 몬스터"와
 * "아직 안 움직인 몬스터"가 섞여 있는 기존 시뮬레이션의 순서 의존적 동작을
 * (틱마다 한 번씩 스냅샷을 다시 찍는 방식으로는) 그대로 보존하기 어렵다.
 */
export class SpatialGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<string>>();
  /** id → 마지막으로 등록된 칸 좌표. remove/updateEntry가 좌표 재계산 없이 바로 지울 수 있게 기억해 둔다. */
  private readonly cellOfId = new Map<string, string>();

  constructor(cellSize: number) {
    if (cellSize <= 0) throw new Error('cellSize는 0보다 커야 한다');
    this.cellSize = cellSize;
  }

  private cellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  clear(): void {
    this.cells.clear();
    this.cellOfId.clear();
  }

  insert(id: string, x: number, y: number): void {
    const key = this.cellKey(x, y);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(key, bucket);
    }
    bucket.add(id);
    this.cellOfId.set(id, key);
  }

  remove(id: string): void {
    const key = this.cellOfId.get(id);
    if (key === undefined) return;
    const bucket = this.cells.get(key);
    bucket?.delete(id);
    if (bucket && bucket.size === 0) this.cells.delete(key);
    this.cellOfId.delete(id);
  }

  /**
   * id의 위치를 (newX, newY)로 갱신한다. 칸이 실제로 안 바뀌었으면 아무 것도 다시
   * 만들지 않는다 — 대부분의 틱에서 느리게 움직이는 몬스터는 칸 경계를 안 넘으므로,
   * remove+insert를 매번 무조건 하는 것보다 이 쪽이 실제 쓰기 횟수가 훨씬 적다.
   */
  updateEntry(id: string, newX: number, newY: number): void {
    const newKey = this.cellKey(newX, newY);
    if (this.cellOfId.get(id) === newKey) return;
    this.remove(id);
    this.insert(id, newX, newY);
  }

  /** (x,y) 중심 반경 radius가 걸치는 칸들에 있는 id 후보를 모은다(중복 없음). */
  queryRadius(x: number, y: number, radius: number): string[] {
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    const result: string[] = [];
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }
}
