import { wavesData, type MonsterType, type WaveEntry } from '../data';

export type GamePhase = 'day' | 'night' | 'victory' | 'defeat';

/**
 * 보스인가. 몬스터 종류 id의 `boss_` 접두사가 유일한 기준이다 — waves.json의
 * bossType과 monsters.json의 키가 이 규칙을 지키고, 클라이언트 HUD도 같은 판정을 쓴다.
 */
export function isBossType(type: string): boolean {
  return type.startsWith('boss_');
}

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
  /** 지금 접속해 있는 인원수. 웨이브 시작 시점(beginNextWave)에만 읽는다 —
   * 밤 도중에 인원이 바뀌어도 이미 확정된 스폰 큐는 안 흔들린다. */
  playerCount?: () => number;
}

/** waves.json spawns 숫자에 인원수 스케일링을 적용한 뒤 반올림한다. */
function scaledSpawnCount(rawCount: number, playerCount: number): number {
  const { baseMultiplier, base, perPlayer } = wavesData.playerScaling;
  return Math.round(rawCount * baseMultiplier * (base + perPlayer * playerCount));
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
  private readonly playerCount: () => number;
  private phase: GamePhase = 'day';
  private phaseTimer: number;
  private waveIndex = -1;
  private spawnQueue: MonsterType[] = [];
  /** 이번 밤의 잡몹 총 마릿수(보스 제외). 밤이 시작될 때 확정된다. */
  private waveMonsterTotal = 0;
  private spawnPoints: SpawnPoint[] = [];
  private spawnTimer = 0;
  /** 스폰 지점을 순서대로 도는 커서. 매번 무작위로 뽑으면 지점 하나에 몰릴 수 있다. */
  private spawnPointCursor = 0;
  /** 이번 밤의 보스가 이미 소환됐는가. bossType이 없는 웨이브(1일차)에서는 안 쓴다. */
  private bossSpawned = false;
  /**
   * 보스 등장까지 남은 예고 시간(초). 0보다 크면 "잡몹은 다 죽었고 보스가 오는 중"이다.
   *
   * 예고 없이 떨어뜨리면 보스가 이미 붙어 있는 상태로 전투가 시작된다 — 자리를 잡거나
   * 회복할 틈이 없다. 이 값은 그대로 화면에 내려가 경고 문구가 된다.
   */
  private bossWarning = 0;

  constructor(options: WaveManagerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.playerCount = options.playerCount ?? (() => 1);
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

  /** 이번 밤의 잡몹 총 마릿수(보스 제외). 낮이면 직전 밤의 값이 남아 있다. */
  get waveMonsterCount(): number {
    return this.waveMonsterTotal;
  }

  /** 아직 안 나온 잡몹 수. 살아있는 수는 World가 알고 있어서 여기서는 큐만 센다. */
  get pendingSpawnCount(): number {
    return this.spawnQueue.length;
  }

  /** 보스 등장까지 남은 예고 시간(초). 0이면 예고 중이 아니다. */
  get bossWarningRemaining(): number {
    return Math.max(0, this.bossWarning);
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

    // waves.json 숫자는 인원수 스케일링 전 "기준값"이다 — 실제 스폰 수는
    // scaledSpawnCount(playerScaling)를 거쳐서 나온다(데모 준비도 리뷰 피드백 #2).
    const players = this.playerCount();
    const flat: MonsterType[] = [];
    for (const [type, count] of Object.entries(entry.spawns)) {
      const scaled = scaledSpawnCount(count, players);
      for (let i = 0; i < scaled; i += 1) flat.push(type as MonsterType);
    }
    // 엘리트는 확정이 아니라 밤 시작에 count번 독립적으로 굴린다 — "나올 수도 있다"가
    // 목적이다. 이 count는 인원수 스케일링을 안 받는다 — 받으면 "낮은 확률로 어쩌다
    // 하나"가 "매 판 여러 마리 확정"으로 바뀌어 버려서 엘리트라는 설계 의도 자체가
    // 깨진다(일반 잡몹처럼 물량으로 밀어붙이는 대상이 아니다).
    if (entry.elite) {
      for (let i = 0; i < entry.elite.count; i += 1) {
        if (this.rng() < entry.elite.chance) flat.push(entry.elite.type as MonsterType);
      }
    }
    this.spawnQueue = shuffle(flat, this.rng);
    // 이번 밤에 잡아야 할 총 마릿수. 엘리트가 주사위로 정해지므로 큐를 다 만든 **뒤에야**
    // 확정된다 — 클라이언트가 waves.json만 보고 계산할 수 없어서 여기서 들고 있는다.
    // 보스는 포함하지 않는다(잡몹을 전멸시켜야 나오고, 그때부터는 보스 체력바가 맡는다).
    this.waveMonsterTotal = flat.length;
    this.spawnPoints = buildSpawnPoints(entry.spawnPoints, wavesData.spawnRadius, this.rng);
    this.spawnTimer = 0;
    this.spawnPointCursor = 0;
    this.bossSpawned = false;
    this.bossWarning = 0;
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
   * 테스트용: 진행 중인 밤을 즉시 끝내고 낮으로 되돌린다. 스폰 큐도 함께 비운다 —
   * 남겨두면 낮에 몬스터가 계속 튀어나온다. 마지막 웨이브였다면 승리로 끝난다
   * (정상 경로와 같은 판정이다). 실제로 밤을 끝냈으면 true.
   *
   * 낮에 딸린 부수 효과(부활·투표 초기화·상점 재추첨)는 여기서 하지 않는다 — 그건
   * World의 몫이고, 정상 경로와 같은 함수를 쓴다.
   */
  debugEndNight(): boolean {
    if (this.phase !== 'night') return false;

    this.spawnQueue.length = 0;
    this.bossWarning = 0;
    if (this.waveIndex >= wavesData.waves.length - 1) {
      this.phase = 'victory';
      return true;
    }
    this.phase = 'day';
    this.phaseTimer = wavesData.dayDuration;
    return true;
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

    // night — groupSize마리씩 묶어 groupIntervalSeconds 간격으로 내보낸다.
    // 첫 무리는 밤 시작 즉시(spawnTimer 0) 나온다. 무리 하나는 같은 스폰 지점에서
    // 함께 나와야 "무리"로 보인다 — 지점 순환은 무리 단위로 돈다.
    const entry = this.currentWaveEntry();

    /*
     * 보스 예고 중에는 이것만 진행한다. 잡몹은 이미 전멸했고 스폰 큐도 비었으므로
     * 아래 루프는 어차피 할 일이 없다 — 여기서 먼저 끊어야 "예고가 도는 동안 낮으로
     * 넘어가 버리는" 경로가 생기지 않는다.
     */
    if (this.bossWarning > 0) {
      this.bossWarning -= dtSeconds;
      if (this.bossWarning > 0) return;
      this.bossWarning = 0;
      this.bossSpawned = true;
      const bossPoint = this.spawnPoints[Math.floor(this.rng() * this.spawnPoints.length)] ?? {
        x: 0,
        y: 0,
      };
      if (entry?.bossType) spawn(entry.bossType as MonsterType, bossPoint.x, bossPoint.y);
      return;
    }

    this.spawnTimer -= dtSeconds;
    while (this.spawnQueue.length > 0 && this.spawnTimer <= 0 && entry) {
      const point = this.spawnPoints[this.spawnPointCursor % this.spawnPoints.length] ?? {
        x: 0,
        y: 0,
      };
      this.spawnPointCursor += 1;

      for (let i = 0; i < entry.groupSize; i += 1) {
        const type = this.spawnQueue.shift();
        if (!type) break;
        spawn(type, point.x, point.y);
      }
      this.spawnTimer += entry.groupIntervalSeconds;
    }

    if (this.spawnQueue.length === 0 && getRemainingMonsters() === 0) {
      // 보스 레이드: 잡몹을 전멸시키면 보스가 등장하고, 보스까지 잡아야 밤이 끝난다.
      // 보스를 스폰하면 다음 틱부터 remainingMonsters > 0이 되므로 아래 전환 분기는
      // 자연히 보스가 죽을 때까지 미뤄진다.
      // 보스는 바로 나오지 않는다 — 예고를 먼저 띄우고 그 시간이 지나야 등장한다.
      if (entry?.bossType && !this.bossSpawned) {
        this.bossWarning = wavesData.bossWarningSeconds;
        return;
      }

      if (this.waveIndex >= wavesData.waves.length - 1) {
        this.phase = 'victory';
      } else {
        this.phase = 'day';
        this.phaseTimer = wavesData.dayDuration;
      }
    }
  }
}
