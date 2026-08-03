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
   * 매 틱 호출. 스폰할 차례가 되면 spawn 콜백으로 타입/좌표를 넘긴다.
   * remainingMonsters는 World가 관리하는 "현재 살아있는 몬스터 수"를 넘겨받는다.
   */
  tick(
    dtSeconds: number,
    remainingMonsters: number,
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

    if (this.spawnQueue.length === 0 && remainingMonsters === 0) {
      if (this.waveIndex >= wavesData.waves.length - 1) {
        this.phase = 'victory';
      } else {
        this.phase = 'day';
        this.phaseTimer = wavesData.dayDuration;
      }
    }
  }
}
