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

const DIRECTIONS = 4;

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
 * 콜로니 4개를 코어 중심 N/E/S/W 고정 위치에 배치하고 관리한다.
 *
 * `BuildingRegistry`(building.ts)와 같은 위상의 서브시스템 전용 소형 상태 클래스다.
 * 밤 웨이브 스폰 지점(wave.ts의 `buildSpawnPoints`)과 달리 **판마다 회전하지 않는다**
 * — 콜로니는 "동쪽 콜로니"처럼 방향으로 기억하고 매번 같은 자리를 다시 찾아가야 하는
 * 고정 랜드마크라, 위치가 판마다 달라지면 그 기억이 무의미해진다.
 */
export class ColonyRegistry {
  private readonly colonies = new Map<string, ColonyEntity>();

  constructor() {
    const initialInterval = colonyStageFor(0).spawnIntervalSeconds;

    for (let i = 0; i < DIRECTIONS; i += 1) {
      // i=0을 정북(위)에 두고 시계방향으로 배치한다. 화면 좌표계는 y가 아래로 증가하므로
      // 정북은 각도 -90도(-PI/2)다.
      const angle = (i / DIRECTIONS) * Math.PI * 2 - Math.PI / 2;
      const id = `colony_${nextColonyId++}`;
      this.colonies.set(id, {
        id,
        x: Math.cos(angle) * coloniesData.spawnRadius,
        y: Math.sin(angle) * coloniesData.spawnRadius,
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
