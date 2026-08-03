import { TICK_RATE } from '@dropfall/shared';
import type { PlayerView, WorldSnapshot } from './GameConnection';

/**
 * 서버(그리고 로컬 시뮬)는 TICK_RATE로만 상태를 갱신하는데 화면은 60fps로 그린다.
 * 매 프레임 "지금 아는 최신 상태"를 그대로 그리면 같은 좌표를 여러 프레임 반복하다가
 * 한 번에 튀는 식으로 보여서 뚝뚝 끊겨 보인다.
 *
 * 최근 스냅샷을 타임스탬프와 함께 버퍼에 쌓아두고, "지금보다 INTERP_DELAY_MS 전" 시점을
 * 두 스냅샷 사이에서 선형 보간해서 그리면 매 프레임 부드럽게 움직인다. 대가로 화면에 보이는
 * 위치가 실제보다 INTERP_DELAY_MS만큼 늦게 반영된다.
 *
 * 지연은 **틱 간격의 배수**로 정의한다(하드코딩한 ms 값이 아니라) — TICK_RATE가 바뀌어도
 * (docs/backend/13) 이 파일을 다시 튜닝할 필요가 없다. 2틱 여유를 두는 이유: 1틱만 두면
 * 버퍼가 스냅샷 두 개 사이를 딱 채우는 수준이라 네트워크 지터로 다음 스냅샷이 조금만 늦게
 * 와도 보간할 "미래" 스냅샷이 없어 마지막 값에 스냅(정지)되는 구간이 잦아진다.
 *
 * ColyseusConnection과 LocalConnection 양쪽 다 내부 상태 갱신 주기가 TICK_RATE로 동일해서
 * 같은 문제를 겪는다 — 그래서 이 클래스는 전송 방식과 무관하게 재사용한다.
 */

const INTERP_DELAY_TICKS = 2;
const INTERP_DELAY_MS = (INTERP_DELAY_TICKS * 1000) / TICK_RATE;
/** 이보다 오래된 스냅샷은 버린다. 재접속 등으로 버퍼가 무한히 쌓이는 것을 막는다. */
const MAX_BUFFER_AGE_MS = 1000;
/**
 * 지연 마진(2틱 ≈ 33ms)보다 새 스냅샷이 늦게 도착하면(네트워크 지터, 프레임 타이밍 등)
 * 보간할 "미래" 스냅샷이 없어 그대로 멈춰버린다 — 마진을 늘리면 반응성이 다시 나빠지니,
 * 대신 마지막 두 스냅샷의 속도로 잠깐 외삽(dead reckoning)해서 멈추지 않게 한다.
 * 이 시간을 넘어서도 새 스냅샷이 안 오면(재접속·끊김 등) 엉뚱한 방향으로 계속 튀어나갈
 * 위험이 커지므로 외삽을 멈추고 마지막 위치에 고정한다.
 */
const MAX_EXTRAPOLATION_MS = 100;

interface BufferedSnapshot {
  time: number;
  players: PlayerView[];
}

interface Bracket {
  from: BufferedSnapshot;
  to: BufferedSnapshot;
  t: number;
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

export class SnapshotInterpolator {
  private readonly buffer: BufferedSnapshot[] = [];
  private readonly output: WorldSnapshot = { players: [] };

  /** 새 네트워크/시뮬 상태가 들어올 때마다 호출한다. */
  push(snapshot: WorldSnapshot, now: number = performance.now()): void {
    this.buffer.push({ time: now, players: snapshot.players.map((player) => ({ ...player })) });

    const cutoff = now - MAX_BUFFER_AGE_MS;
    while (this.buffer.length > 2 && this.buffer[0].time < cutoff) {
      this.buffer.shift();
    }
  }

  /** 매 렌더 프레임 호출. INTERP_DELAY_MS만큼 과거 시점을 보간(또는 필요시 외삽)해 돌려준다. */
  sample(now: number = performance.now()): WorldSnapshot {
    const players = this.output.players;
    players.length = 0;

    const renderTime = now - INTERP_DELAY_MS;
    const last = this.buffer[this.buffer.length - 1];

    // 버퍼 부족: 다음 스냅샷이 아직 안 왔다. 짧은 지터면 마지막 속도로 외삽하고,
    // 너무 오래 끌면(재접속 등) 엉뚱하게 튀지 않도록 그냥 마지막 위치에 고정한다.
    if (last && renderTime >= last.time) {
      const overshootMs = Math.min(renderTime - last.time, MAX_EXTRAPOLATION_MS);
      this.extrapolate(players, last, overshootMs);
      return this.output;
    }

    const bracket = this.findBracket(renderTime);
    if (!bracket) return this.output;

    const { from, to, t } = bracket;
    for (const toPlayer of to.players) {
      const fromPlayer = from.players.find((player) => player.id === toPlayer.id);
      if (!fromPlayer) {
        players.push(toPlayer); // 방금 등장한 플레이어는 보간할 과거 스냅샷이 없다
        continue;
      }

      players.push({
        id: toPlayer.id,
        nickname: toPlayer.nickname,
        x: lerp(fromPlayer.x, toPlayer.x, t),
        y: lerp(fromPlayer.y, toPlayer.y, t),
        aimAngle: lerpAngle(fromPlayer.aimAngle, toPlayer.aimAngle, t),
        lastProcessedSeq: toPlayer.lastProcessedSeq,
      });
    }

    return this.output;
  }

  /** 마지막 두 스냅샷 사이의 속도로 overshootMs만큼 앞으로 밀어서 예측한다. */
  private extrapolate(players: PlayerView[], last: BufferedSnapshot, overshootMs: number): void {
    const prev = this.buffer.length >= 2 ? this.buffer[this.buffer.length - 2] : undefined;
    const dt = prev ? last.time - prev.time : 0;

    for (const player of last.players) {
      const prevPlayer = prev?.players.find((p) => p.id === player.id);
      if (!prevPlayer || dt <= 0) {
        players.push(player); // 속도를 알 수 없으면 마지막 위치 그대로
        continue;
      }

      const vx = (player.x - prevPlayer.x) / dt;
      const vy = (player.y - prevPlayer.y) / dt;

      players.push({
        ...player,
        x: player.x + vx * overshootMs,
        y: player.y + vy * overshootMs,
      });
    }
  }

  /**
   * 호출 시점에는 이미 `renderTime < last.time`이 보장된다(그 이상은 sample()이
   * 외삽 경로로 먼저 처리하고 여기까지 오지 않는다) — 그래서 두 스냅샷 사이 구간만 다룬다.
   */
  private findBracket(renderTime: number): Bracket | null {
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
