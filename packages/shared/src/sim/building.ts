import { buildingsData, type BuildingType } from '../data';

export interface BuildingEntity {
  id: string;
  type: BuildingType;
  /** 그리드 셀 좌표(점유 판정·Flow Field 재계산용) */
  cx: number;
  cy: number;
  /** 그 셀 중심의 월드 좌표. 배치 시 1회 계산해 둔다 — circlesOverlap 같은 기존
   * 월드 좌표 기반 판정을 셀↔월드 변환 없이 그대로 재사용하기 위해서다. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * 건축물을 관리하고, 셀 좌표 → 건축물 O(1) 조회 인덱스를 함께 유지한다.
 *
 * `WeaponCooldowns`(combat.ts)와 같은 위상의 소형 상태 클래스다. `buildings` Map을
 * 매번 선형 스캔하지 않는 이유: `FlowField`의 `isBlocked`/`hasLineOfSight` 콜백이
 * 몬스터마다, 틱마다 여러 번(직선 경로 위 여러 셀에 대해) 호출된다 — 건축물 수가
 * 늘어나면 이 스캔 비용이 그대로 몬스터 수 × 틱마다 곱해져서, cell 인덱스 없이는
 * 건축물이 몇 개만 늘어나도 눈에 띄게 느려진다.
 */
export class BuildingRegistry {
  private readonly byId = new Map<string, BuildingEntity>();
  private readonly byCell = new Map<string, string>();

  /** 이미 그 셀에 건물이 있는지만 검사한다 — 코어/자원 노드/플레이어 위치 검사는 World 몫이다. */
  canPlace(cx: number, cy: number): boolean {
    return !this.byCell.has(cellKey(cx, cy));
  }

  /** 호출 전 `canPlace`로 이미 검증됐다고 가정한다. */
  place(id: string, type: BuildingType, cx: number, cy: number, x: number, y: number): BuildingEntity {
    const data = buildingsData[type];
    const building: BuildingEntity = { id, type, cx, cy, x, y, hp: data.hp, maxHp: data.hp };
    this.byId.set(id, building);
    this.byCell.set(cellKey(cx, cy), id);
    return building;
  }

  remove(id: string): void {
    const building = this.byId.get(id);
    if (!building) return;
    this.byId.delete(id);
    this.byCell.delete(cellKey(building.cx, building.cy));
  }

  get(id: string): BuildingEntity | undefined {
    return this.byId.get(id);
  }

  values(): IterableIterator<BuildingEntity> {
    return this.byId.values();
  }

  /** id → 건축물 전체 맵. GameRoom 동기화처럼 여러 번 순회해야 하는 소비자용. */
  entries(): ReadonlyMap<string, BuildingEntity> {
    return this.byId;
  }

  at(cx: number, cy: number): BuildingEntity | undefined {
    const id = this.byCell.get(cellKey(cx, cy));
    return id ? this.byId.get(id) : undefined;
  }

  isBlockedForMovement(cx: number, cy: number): boolean {
    const building = this.at(cx, cy);
    return building ? buildingsData[building.type].blocksMovement : false;
  }

  isBlockedForProjectile(cx: number, cy: number): boolean {
    const building = this.at(cx, cy);
    return building ? buildingsData[building.type].blocksProjectile : false;
  }
}
