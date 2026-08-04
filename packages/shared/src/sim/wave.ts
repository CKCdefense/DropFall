import { wavesData, type MonsterType, type WaveEntry } from '../data';

export type GamePhase = 'day' | 'night' | 'victory' | 'defeat';

interface SpawnPoint {
  x: number;
  y: number;
}

/** Fisher-Yates. rng를 주입받아 테스트에서 결정론적으로 검증한다. */
function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildSpawnPoints(count: number, radius: number, rng: () => number): SpawnPoint[] {
  const rotation = rng() * Math.PI * 2;
  const points: SpawnPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rotation + (i / count) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

export interface WaveManagerOptions {
  rng?: () => number;
}

/**
 * 웨이브 진행(낮/밤 페이즈, 몬스터 스폰 스케줄링, 승패 판정)을 관리한다.
 *
 * 낮 페이즈는 dayDuration(90초) 카운트다운 또는 전원 스킵 투표(skipDay(), World가
 * 투표 집계 후 호출) 중 먼저 오는 쪽으로 끝난다(docs/backend/11 §4.1 — 팀 협의 완료,
 * 만장일치 방식은 World가 담당).
 *
 * 몬스터 엔티티 자체는 World가 들고 있고, WaveManager는 "지금 살아있는 몬스터 수"만
 * remainingMonsters로 넘겨받는다 — 몬스터 목록을 이중으로 관리하지 않기 위해서다.
 */
export class WaveManager {
  private readonly rng: () => number;
  private phase: GamePhase = 'day';
  private phaseTimer: number;
  private waveIndex = -1;
  private spawnQueue: MonsterType[] = [];
  private spawnPoints: SpawnPoint[] = [];
  private spawnInterval = 1;
  private spawnTimer = 0;
  /** 스폰 지점을 순서대로 도는 커서. 매번 무작위로 뽑으면 지점 하나에 몰릴 수 있다. */
  private spawnPointCursor = 0;

  constructor(options: WaveManagerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.phaseTimer = wavesData.dayDuration;
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  /** 1-based. 첫 밤이 아직 시작 안 했으면 0. */
  get currentWave(): number {
    return this.waveIndex + 1;
  }

  get phaseTimeRemaining(): number {
    return Math.max(0, this.phaseTimer);
  }

  private currentWaveEntry(): WaveEntry | undefined {
    return wavesData.waves[this.waveIndex];
  }

  private beginNextWave(): void {
    this.waveIndex += 1;
    const entry = this.currentWaveEntry();
    if (!entry) {
      this.phase = 'victory';
      return;
    }

    const flat: MonsterType[] = [];
    for (const [type, count] of Object.entries(entry.spawns)) {
      for (let i = 0; i < count; i += 1) flat.push(type as MonsterType);
    }
    this.spawnQueue = shuffle(flat, this.rng);
    this.spawnPoints = buildSpawnPoints(entry.spawnPoints, wavesData.spawnRadius, this.rng);
    this.spawnInterval =
      this.spawnQueue.length > 0 ? entry.nightDuration / this.spawnQueue.length : 0;
    this.spawnTimer = 0;
    this.spawnPointCursor = 0;
    this.phase = 'night';
  }

  /** 코어 HP 0 등 즉시 패배 조건이 발생했을 때 호출한다. */
  markDefeat(): void {
    this.phase = 'defeat';
  }

  /** 낮 페이즈를 즉시 종료하고 다음 웨이브를 시작한다. 전원 스킵 투표 통과 시 World가 호출한다. */
  skipDay(): void {
    if (this.phase !== 'day') return;
    this.beginNextWave();
  }

  /**
   * 테스트용: 특정 웨이브(1-based)로 즉시 이동해 그 웨이브의 밤을 시작한다. 중간
   * 웨이브는 전부 건너뛴다 — 게임 정상 진행 경로가 아니라 로컬 밸런스 테스트 전용이다
   * (docs/backend/23). `waveIndex`를 `beginNextWave()`가 기대하는 "한 칸 전"으로
   * 맞춰두고 그 메서드를 그대로 호출한다 — 스폰 큐/지점 재구성 로직을 중복 구현하지
   * 않기 위해서다. 범위를 벗어난 웨이브 번호나 이미 승리/패배한 상태면 아무것도 안
   * 하고 false를 돌려준다 — 호출자(World)가 이 경우 몬스터 정리 같은 부수 효과를
   * 건너뛸 수 있도록.
   */
  debugJumpToWave(waveNumber: number): boolean {
    if (this.phase === 'victory' || this.phase === 'defeat') return false;
    const targetIndex = waveNumber - 1;
    if (targetIndex < 0 || targetIndex >= wavesData.waves.length) return false;

    this.waveIndex = targetIndex - 1;
    this.beginNextWave();
    return true;
  }

  /**
   * 매 틱 호출. 스폰할 차례가 되면 spawn 콜백으로 타입/좌표를 넘긴다.
   *
   * getRemainingMonsters는 값이 아니라 **콜백**이다 — 값(스냅샷)으로 받으면 이 함수
   * 호출 시점(= World가 인자를 평가하는 시점) 기준의 "그 틱이 시작되기 전" 마릿수가
   * 박제된다. 그런데 바로 아래 스폰 루프가 이번 틱 안에서 새 몬스터를 추가할 수 있고,
   * 하필 그 스폰이 spawnQueue를 마지막으로 비우는 스폰이면, "스폰 큐도 비었고
   * remainingMonsters도 0"이라는 낡은 조건이 그대로 참이 되어 **방금 스폰돼 아직
   * 살아있는 몬스터를 무시하고** 낮으로 전환해버렸다(실제로 재현 확인함). 콜백으로
   * 받아서 스폰 루프가 끝난 뒤 그 자리에서 다시 부르면 이번 틱의 스폰이 반영된 최신
   * 마릿수를 본다.
   */
  tick(
    dtSeconds: number,
    getRemainingMonsters: () => number,
    spawn: (type: MonsterType, x: number, y: number) => void,
  ): void {
    if (this.phase === 'victory' || this.phase === 'defeat') return;

    if (this.phase === 'day') {
      this.phaseTimer -= dtSeconds;
      if (this.phaseTimer <= 0) this.beginNextWave();
      return;
    }

    // night
    this.spawnTimer -= dtSeconds;
    while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
      const type = this.spawnQueue.shift();
      if (!type) break;
      // 무작위 선택 대신 순서대로 순환시켜, 지점 하나에 스폰이 몰리지 않고 고르게 퍼지게 한다.
      const point = this.spawnPoints[this.spawnPointCursor % this.spawnPoints.length] ?? {
        x: 0,
        y: 0,
      };
      this.spawnPointCursor += 1;
      spawn(type, point.x, point.y);
      this.spawnTimer += this.spawnInterval;
    }

    if (this.spawnQueue.length === 0 && getRemainingMonsters() === 0) {
      if (this.waveIndex >= wavesData.waves.length - 1) {
        this.phase = 'victory';
      } else {
        this.phase = 'day';
        this.phaseTimer = wavesData.dayDuration;
      }
    }
  }
}
