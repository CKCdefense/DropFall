import { coloniesData, type ColonyStage } from '../data';

export interface ColonyEntity {
  id: string;
  x: number;
  y: number;
  /** 채널링 1회 완료로 파괴되면 true. 파괴돼도 엔티티 자체는 지우지 않는다(위치는
   * 랜드마크로 계속 의미가 있고, 클라이언트가 "부서졌다"는 상태를 보여줄 수 있게). */
  destroyed: boolean;
  /** 다음 스폰까지 남은 시간(초). destroyed면 더 이상 줄어들지 않는다. */
  spawnTimer: number;
}

/**
 * 코어를 표준 수학적 사분면(I~IV) 4개로 나눈다 — 사분면당 콜로니는 최대 1개까지만
 * (docs/backend/41). 사분면 i는 각도 `[i·90°, (i+1)·90°)` 범위다(0°는 +x축, 반시계
 * 방향 — 화면 y가 아래로 증가하는 것과는 무관하게 순수 각도 계산일 뿐이다).
 */
const QUADRANTS = 4;
const QUADRANT_ANGLE = (Math.PI * 2) / QUADRANTS;
/** 사분면 안에서 좋은 위치를 못 찾아도(최소 간격을 계속 어기면) 포기하고 마지막
 * 후보를 쓰기까지의 재시도 횟수. world.ts의 `pickClusterNodePosition`과 같은 값 —
 * 완벽한 조건보다 무한 재시도 방지가 우선이라는 같은 판단이다. */
const MAX_PLACEMENT_ATTEMPTS = 8;

/**
 * 콜로니 자신의 충돌 판정 반경(px) — 몬스터/플레이어/투사체가 통과하지 못하게 막는
 * 하드 충돌에 쓴다(docs/backend/38). 클라이언트 렌더 크기(`COLONY_SIZE = 28` in
 * EntityRenderer.ts)의 절반과 값을 맞춰서 "보이는 크기 = 막히는 범위" 원칙을 지킨다.
 */
export const COLONY_RADIUS = 14;

let nextColonyId = 1;

/**
 * 현재 웨이브에 맞는 난이도 구간을 고른다 — `afterWave`가 `currentWave` 이하인
 * 항목 중 가장 큰(가장 최근에 열린) 것. `coloniesData.stages`는 최소 1개 보장되고
 * 첫 항목의 `afterWave`가 0이므로(스키마상 강제는 아니지만 데이터 관례) 항상 결과가 있다.
 */
export function colonyStageFor(currentWave: number): ColonyStage {
  let best = coloniesData.stages[0];
  for (const stage of coloniesData.stages) {
    if (stage.afterWave <= currentWave && stage.afterWave >= best.afterWave) best = stage;
  }
  return best;
}

/**
 * 사분면 `quadrant` 안에서 무작위 위치를 고른다. 이미 배치된 다른 콜로니 중
 * 하나라도 `coloniesData.minSpacing`보다 가까우면 다시 뽑는다(재시도
 * `MAX_PLACEMENT_ATTEMPTS`회) — 사분면이 인접하면 경계 각도 부근에서 두 콜로니가
 * 거의 붙어버릴 수 있어서 필요하다. `placed`엔 이미 배치된 모든 콜로니(다른
 * 사분면 포함)를 넘긴다 — 사분면이 4개뿐이라 "인접한 것만" 따로 가리는 것보다
 * 전부와 비교하는 게 더 간단하고 안전하다.
 */
function pickQuadrantPosition(
  quadrant: number,
  placed: { x: number; y: number }[],
  rng: () => number,
): { x: number; y: number } {
  const quadrantStart = quadrant * QUADRANT_ANGLE;
  let candidate = { x: 0, y: 0 };

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
    const angle = quadrantStart + rng() * QUADRANT_ANGLE;
    const distance =
      coloniesData.spawnRadiusMin + rng() * (coloniesData.spawnRadiusMax - coloniesData.spawnRadiusMin);
    candidate = { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };

    const tooClose = placed.some(
      (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < coloniesData.minSpacing,
    );
    if (!tooClose) return candidate;
  }

  return candidate; // 재시도로도 못 찾으면 마지막 후보를 그냥 쓴다(무한 재시도 방지 우선)
}

/** Fisher-Yates 셔플. 콜로니가 항상 같은 사분면 조합(예: 인원이 적으면 늘 0번부터)만
 * 쓰지 않도록, 어느 사분면을 쓸지도 매판 무작위로 고른다. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * 콜로니를 사분면당 최대 1개씩, 접속 인원수만큼 배치하고 관리한다(docs/backend/41).
 *
 * `BuildingRegistry`(building.ts)와 같은 위상의 서브시스템 전용 소형 상태 클래스다.
 * 밤 웨이브 스폰 지점(wave.ts의 `buildSpawnPoints`)과 달리 콜로니는 판이 끝날
 * 때까지 위치가 고정인 랜드마크지만, **판마다는** 인원수·배치 둘 다 달라진다.
 *
 * 생성자에서 바로 콜로니를 만들지 않는다 — 인원이 몇 명일지는 `World` 생성
 * 시점엔 알 수 없다(서버는 로비가 끝나야, 즉 게임이 실제로 시작돼야 확정된다).
 * 인원이 확정된 시점에 호출자가 `seed(count, rng)`를 명시적으로 한 번 불러야 한다.
 */
export class ColonyRegistry {
  private readonly colonies = new Map<string, ColonyEntity>();

  /**
   * `count`개(사분면 최대 4개로 clamp)를 서로 다른 사분면에 하나씩 배치한다.
   * 정확히 한 번만 호출해야 한다(호출할 때마다 기존 콜로니에 더해 새로 추가되므로,
   * 두 번 부르면 사분면당 1개 제약이 깨진다).
   */
  seed(count: number, rng: () => number): void {
    const initialInterval = colonyStageFor(0).spawnIntervalSeconds;
    const quadrantCount = Math.max(1, Math.min(count, QUADRANTS));
    const quadrants = shuffled([0, 1, 2, 3], rng).slice(0, quadrantCount);

    const placed: { x: number; y: number }[] = [];
    for (const quadrant of quadrants) {
      const position = pickQuadrantPosition(quadrant, placed, rng);
      placed.push(position);

      const id = `colony_${nextColonyId++}`;
      this.colonies.set(id, {
        id,
        x: position.x,
        y: position.y,
        destroyed: false,
        spawnTimer: initialInterval,
      });
    }
  }

  values(): IterableIterator<ColonyEntity> {
    return this.colonies.values();
  }

  get(id: string): ColonyEntity | undefined {
    return this.colonies.get(id);
  }

  /** id → 콜로니 전체 맵. GameRoom 동기화처럼 여러 번 순회해야 하는 소비자용. */
  entries(): ReadonlyMap<string, ColonyEntity> {
    return this.colonies;
  }

  /** 파괴 표시만 한다 — 엔티티는 그대로 남는다(§ColonyEntity.destroyed 참고). */
  destroy(id: string): void {
    const colony = this.colonies.get(id);
    if (colony) colony.destroyed = true;
  }
}
