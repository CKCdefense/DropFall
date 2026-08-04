import { PATCH_RATE } from '@dropfall/shared';
import type {
  BuildingView,
  MonsterView,
  PlayerView,
  ProjectileView,
  ResourceNodeView,
  WorldSnapshot,
  WorldStatus,
} from './GameConnection';

/**
 * 서버(그리고 로컬 시뮬)는 정해진 주기로만 상태를 갱신하는데 화면은 60fps로 그린다.
 * 매 프레임 "지금 아는 최신 상태"를 그대로 그리면 같은 좌표를 여러 프레임 반복하다가
 * 한 번에 튀는 식으로 보여서 뚝뚝 끊겨 보인다.
 *
 * 최근 스냅샷을 타임스탬프와 함께 버퍼에 쌓아두고, "지금보다 INTERP_DELAY_MS 전" 시점을
 * 두 스냅샷 사이에서 선형 보간해서 그리면 매 프레임 부드럽게 움직인다. 대가로 화면에 보이는
 * 위치가 실제보다 INTERP_DELAY_MS만큼 늦게 반영된다.
 *
 * 지연의 기준은 **스냅샷이 도착하는 주기(PATCH_RATE)** 다. 서버 내부 틱(TICK_RATE)이 아니다 —
 * 보간은 "도착한 스냅샷 두 개 사이"를 채우는 일이라 서버가 내부적으로 몇 번 계산했는지와는
 * 무관하다. 실제로 이 둘을 혼동해서, 틱만 60Hz로 올리고 patchRate를 20Hz 기본값으로 둔 탓에
 * 지연(33ms)이 실제 도착 간격(63ms)보다 짧아져 프레임의 47%가 외삽으로 그려진 적이 있다
 * (docs/frontend/05).
 *
 * 2주기 여유를 두는 이유: 1주기만 두면 버퍼가 스냅샷 두 개 사이를 딱 채우는 수준이라
 * 네트워크 지터로 다음 스냅샷이 조금만 늦게 와도 보간할 "미래" 스냅샷이 없어진다.
 *
 * ColyseusConnection과 LocalConnection 양쪽 다 상태 갱신 주기가 동일해서 같은 문제를
 * 겪는다 — 그래서 이 클래스는 전송 방식과 무관하게 재사용한다.
 */

const INTERP_DELAY_PATCHES = 2;
const INTERP_DELAY_MS = (INTERP_DELAY_PATCHES * 1000) / PATCH_RATE;
/** 이보다 오래된 스냅샷은 버린다. 재접속 등으로 버퍼가 무한히 쌓이는 것을 막는다. */
const MAX_BUFFER_AGE_MS = 1000;
/**
 * 지연 마진(INTERP_DELAY_MS)보다 새 스냅샷이 늦게 도착하면(네트워크 지터, 프레임 타이밍 등)
 * 보간할 "미래" 스냅샷이 없어 그대로 멈춰버린다 — 마진을 늘리면 반응성이 다시 나빠지니,
 * 대신 마지막 두 스냅샷의 속도로 잠깐 외삽(dead reckoning)해서 멈추지 않게 한다.
 * 이 시간을 넘어서도 새 스냅샷이 안 오면(재접속·끊김 등) 엉뚱한 방향으로 계속 튀어나갈
 * 위험이 커지므로 외삽을 멈추고 마지막 위치에 고정한다.
 */
const MAX_EXTRAPOLATION_MS = 100;

/** 보간 대상의 최소 조건 — id로 짝을 찾고 x/y를 섞는다. */
interface Positioned {
  id: string;
  x: number;
  y: number;
}

interface BufferedSnapshot {
  time: number;
  players: PlayerView[];
  monsters: MonsterView[];
  projectiles: ProjectileView[];
  resourceNodes: ResourceNodeView[];
  buildings: BuildingView[];
  status: WorldStatus;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 최단 경로로 각도를 보간한다 — 그냥 lerp하면 -π/π 경계에서 반대 방향으로 크게 돈다. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * 두 스냅샷 사이를 섞는다. 기준은 항상 `to`(더 최신) — 방금 등장한 엔티티는 과거가 없으므로
 * 그대로 쓰고, 사라진 엔티티는 결과에 넣지 않는다.
 */
function blendList<T extends Positioned>(from: T[], to: T[], t: number, out: T[]): void {
  out.length = 0;
  for (const target of to) {
    const previous = from.find((item) => item.id === target.id);
    if (!previous) {
      out.push(target);
      continue;
    }
    out.push({ ...target, x: lerp(previous.x, target.x, t), y: lerp(previous.y, target.y, t) });
  }
}

/** 마지막 두 스냅샷 사이의 속도로 overshootMs만큼 앞으로 밀어서 예측한다. */
function extrapolateList<T extends Positioned>(
  previous: T[] | undefined,
  last: T[],
  dt: number,
  overshootMs: number,
  out: T[],
): void {
  out.length = 0;
  for (const item of last) {
    const before = previous?.find((candidate) => candidate.id === item.id);
    if (!before || dt <= 0) {
      out.push(item); // 속도를 알 수 없으면 마지막 위치 그대로
      continue;
    }
    out.push({
      ...item,
      x: item.x + ((item.x - before.x) / dt) * overshootMs,
      y: item.y + ((item.y - before.y) / dt) * overshootMs,
    });
  }
}

const EMPTY_STATUS: WorldStatus = {
  coreHp: 0,
  coreMaxHp: 0,
  wavePhase: 'day',
  currentWave: 0,
  skipVoteCount: 0,
};

export class SnapshotInterpolator {
  private readonly buffer: BufferedSnapshot[] = [];
  private readonly output: WorldSnapshot = {
    players: [],
    monsters: [],
    projectiles: [],
    resourceNodes: [],
    buildings: [],
    status: { ...EMPTY_STATUS },
  };

  /** 새 네트워크/시뮬 상태가 들어올 때마다 호출한다. */
  push(snapshot: WorldSnapshot, now: number = performance.now()): void {
    this.buffer.push({
      time: now,
      players: snapshot.players.map((player) => ({ ...player })),
      monsters: snapshot.monsters.map((monster) => ({ ...monster })),
      projectiles: snapshot.projectiles.map((projectile) => ({ ...projectile })),
      resourceNodes: snapshot.resourceNodes.map((node) => ({ ...node })),
      buildings: snapshot.buildings.map((building) => ({ ...building })),
      status: { ...snapshot.status },
    });

    const cutoff = now - MAX_BUFFER_AGE_MS;
    while (this.buffer.length > 2 && this.buffer[0].time < cutoff) {
      this.buffer.shift();
    }
  }

  /** 매 렌더 프레임 호출. INTERP_DELAY_MS만큼 과거 시점을 보간(또는 필요시 외삽)해 돌려준다. */
  sample(now: number = performance.now()): WorldSnapshot {
    const last = this.buffer[this.buffer.length - 1];
    if (!last) return this.output;

    // 코어 HP·웨이브 같은 비위치 값은 보간하지 않는다 — 항상 최신값이 맞다.
    Object.assign(this.output.status, last.status);

    const renderTime = now - INTERP_DELAY_MS;

    // 버퍼 부족: 다음 스냅샷이 아직 안 왔다. 짧은 지터면 마지막 속도로 외삽하고,
    // 너무 오래 끌면(재접속 등) 엉뚱하게 튀지 않도록 그냥 마지막 위치에 고정한다.
    if (renderTime >= last.time) {
      const previous = this.buffer[this.buffer.length - 2];
      const dt = previous ? last.time - previous.time : 0;
      const overshootMs = Math.min(renderTime - last.time, MAX_EXTRAPOLATION_MS);

      extrapolateList(previous?.players, last.players, dt, overshootMs, this.output.players);
      extrapolateList(previous?.monsters, last.monsters, dt, overshootMs, this.output.monsters);
      extrapolateList(
        previous?.projectiles,
        last.projectiles,
        dt,
        overshootMs,
        this.output.projectiles,
      );
      // 자원 노드/건축물은 위치가 고정이라 외삽할 속도가 없다 — 그냥 최신값을 그대로 쓴다.
      this.output.resourceNodes = last.resourceNodes;
      this.output.buildings = last.buildings;
      return this.output;
    }

    const bracket = this.findBracket(renderTime);
    if (!bracket) return this.output;

    const { from, to, t } = bracket;
    blendList(from.players, to.players, t, this.output.players);
    blendList(from.monsters, to.monsters, t, this.output.monsters);
    blendList(from.projectiles, to.projectiles, t, this.output.projectiles);
    this.output.resourceNodes = to.resourceNodes;
    this.output.buildings = to.buildings;

    // 조준각은 위치와 달리 최단 경로로 섞어야 한다.
    for (const player of this.output.players) {
      const before = from.players.find((item) => item.id === player.id);
      const target = to.players.find((item) => item.id === player.id);
      if (before && target) player.aimAngle = lerpAngle(before.aimAngle, target.aimAngle, t);
    }

    return this.output;
  }

  /**
   * 호출 시점에는 이미 `renderTime < last.time`이 보장된다(그 이상은 sample()이
   * 외삽 경로로 먼저 처리하고 여기까지 오지 않는다) — 그래서 두 스냅샷 사이 구간만 다룬다.
   */
  private findBracket(
    renderTime: number,
  ): { from: BufferedSnapshot; to: BufferedSnapshot; t: number } | null {
    if (this.buffer.length === 0) return null;

    const first = this.buffer[0];
    if (this.buffer.length === 1 || renderTime <= first.time) {
      return { from: first, to: first, t: 0 };
    }

    for (let i = 0; i < this.buffer.length - 1; i += 1) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];
      if (renderTime >= a.time && renderTime <= b.time) {
        const span = b.time - a.time;
        return { from: a, to: b, t: span > 0 ? (renderTime - a.time) / span : 0 };
      }
    }

    return { from: first, to: first, t: 0 };
  }
}
