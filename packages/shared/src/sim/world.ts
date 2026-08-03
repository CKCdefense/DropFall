import type { PlayerInputMessage } from '../protocol/messages';

const PLAYER_SPEED = 100; // px/sec, placeholder — 밸런스 확정 전까지 임의값

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface PlayerEntity {
  id: string;
  x: number;
  y: number;
  aimAngle: number;
  lastProcessedSeq: number;
}

export class World {
  private players = new Map<string, PlayerEntity>();
  private inputs = new Map<string, PlayerInputMessage>();

  addPlayer(id: string, x = 0, y = 0): void {
    this.players.set(id, { id, x, y, aimAngle: 0, lastProcessedSeq: 0 });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.inputs.delete(id);
  }

  // 클라이언트 입력은 신뢰하지 않는다 — 서버 권위 모델의 경계에서 타입/범위를 강제한다.
  // 필드가 없거나 숫자가 아니면(NaN 포함) 통째로 무시한다 — 한 번이라도 NaN이 x/y에
  // 섞이면 이후 모든 tick에서 계속 NaN으로 오염되기 때문에 여기서 반드시 걸러야 한다.
  setInput(id: string, input: PlayerInputMessage): void {
    if (
      typeof input !== 'object' ||
      input === null ||
      !isFiniteNumber(input.seq) ||
      !isFiniteNumber(input.moveX) ||
      !isFiniteNumber(input.moveY) ||
      !isFiniteNumber(input.aimAngle)
    ) {
      return;
    }

    // 순서가 뒤바뀌었거나 중복된 입력은 버린다. 받아들이면 lastProcessedSeq가 되감기고,
    // 클라이언트가 이미 확정한 구간을 다시 재조정하면서 캐릭터가 튄다.
    const previous = this.inputs.get(id);
    if (previous && input.seq <= previous.seq) return;

    // 대각선 보정: clamp만 하면 (1,1)이 통과해서 대각선 속도가 √2배(약 141%)가 된다.
    let moveX = clamp(input.moveX, -1, 1);
    let moveY = clamp(input.moveY, -1, 1);
    const length = Math.hypot(moveX, moveY);
    if (length > 1) {
      moveX /= length;
      moveY /= length;
    }

    this.inputs.set(id, { seq: input.seq, moveX, moveY, aimAngle: input.aimAngle });
  }

  tick(dtSeconds: number): void {
    for (const [id, player] of this.players) {
      const input = this.inputs.get(id);
      if (!input) continue;
      player.x += input.moveX * PLAYER_SPEED * dtSeconds;
      player.y += input.moveY * PLAYER_SPEED * dtSeconds;
      player.aimAngle = input.aimAngle;
      player.lastProcessedSeq = input.seq;
    }
  }

  getPlayers(): ReadonlyMap<string, PlayerEntity> {
    return this.players;
  }
}
