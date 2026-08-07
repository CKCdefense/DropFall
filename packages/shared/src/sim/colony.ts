import { coloniesData, type ColonyStage } from '../data';

/**
 * 콜로니 — 몬스터가 "저장"돼 있는 거점(docs/backend/41 배치 + 재설계).
 *
 * 라이프사이클:
 *  1. 판 시작에 인원수만큼 사분면 외곽에 배치, 1단계 저장분을 채우고 시작한다.
 *  2. 플레이어가 트리거 반경에 접근하면 저장분에서 수호대가 한 마리씩 소환된다
 *     (동시 guardConcurrent마리 유지). 수호대는 리시 반경 안의 플레이어를 공격하고,
 *     아무도 없으면 콜로니로 돌아가 잠시 뒤 저장 상태로 복귀한다(stored 복원).
 *  3. 저장분과 수호대를 전부 처치하면 **정화** — 팀 에너지 보상 + 단계 1로 초기화.
 *     빈 껍데기 상태로 있다가 다음 낮에 1단계 저장분이 다시 채워진다.
 *  4. 낮 동안 정화하지 않으면 밤 시작에 한 단계 성장한다(저장분이 대략 2배).
 *  5. 밤 웨이브가 시작되면 저장분의 일부가 **복제**되어 콜로니 방향에서 침공에
 *     합류한다(저장분은 그대로 — 줄면 밤 정화가 공짜가 된다).
 *
 * 예전의 채널링 파괴(R키 6초)는 이 정화 메커니즘으로 대체됐다 — 파괴라는 개념이
 * 없어졌으므로 콜로니는 판이 끝날 때까지 장애물로 남는다.
 */
export interface ColonyEntity {
  id: string;
  x: number;
  y: number;
  /** 성장 단계(1-based, 최대 coloniesData.stages.length). */
  stage: number;
  /** 아직 콜로니 안에 저장돼 있는 몬스터 수. 수호대 소환 시 1 줄고 귀환 복귀 시 1 는다. */
  stored: number;
  /** 정화된 빈 껍데기 상태(다음 낮에 재보급). 이 상태에선 수호대도 침공 합류도 없다. */
  purified: boolean;
  /** 다음 수호대 보충 소환까지 남은 시간(초). */
  guardRespawnTimer: number;
  /** 현재 나와 있는 수호대 몬스터 id들. World가 소환/사망/복귀 시 갱신한다. */
  readonly guardIds: Set<string>;
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

/** 단계 번호(1-based)를 데이터 항목으로. 범위를 벗어나면 가장 가까운 끝 단계로 조인다. */
export function colonyStageData(stage: number): ColonyStage {
  const index = Math.max(0, Math.min(stage - 1, coloniesData.stages.length - 1));
  return coloniesData.stages[index]!;
}

/** 최대 단계(현재 3). 성장은 여기서 멈춘다. */
export function maxColonyStage(): number {
  return coloniesData.stages.length;
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
        stage: 1,
        stored: colonyStageData(1).stored,
        purified: false,
        guardRespawnTimer: 0,
        guardIds: new Set(),
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
}
