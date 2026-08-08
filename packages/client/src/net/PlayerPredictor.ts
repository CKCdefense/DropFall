import { resolvePlayerMove, TICK_RATE } from '@dropfall/shared';

/** 서버가 한 입력을 처리할 때 쓰는 것과 같은 고정 스텝(fixedStep.ts 참고) — 가변
 * 프레임 dt를 쓰면 서버와 예측이 어긋난다. */
const FIXED_DT_SECONDS = 1 / TICK_RATE;

/** 재조정이 한동안 안 와도(재접속 등) 큐가 무한정 안 쌓이게 두는 상한. */
const MAX_PENDING_INPUTS = 240; // TICK_RATE 기준 약 4초치

/**
 * `renderPosition()`이 마지막 입력 이후 앞서 내다볼 수 있는 최대 시간(ms).
 * `SnapshotInterpolator`의 `MAX_EXTRAPOLATION_MS`와 같은 값·같은 이유 — 입력
 * 전송이 한동안 끊기면(탭 백그라운드 등) 엉뚱한 방향으로 계속 미끄러지지 않게 막는다.
 */
const MAX_RENDER_LOOKAHEAD_MS = 100;

interface PendingInput {
  seq: number;
  moveX: number;
  moveY: number;
  /** 스프린트 등으로 그 순간 적용된 배율. 재조정 때 같은 배율로 재생해야 정확하다. */
  speedMultiplier: number;
}

/**
 * 내 캐릭터(로컬 플레이어) 전용 클라이언트 예측 + 재조정.
 *
 * 왜 필요한가: 이 클라이언트는 원격 엔티티든 내 캐릭터든 전부 `SnapshotInterpolator`로
 * 서버 스냅샷을 도착 시각 기준으로 재생한다(docs/backend/55 참고) — 그래서 내 캐릭터의
 * 화면상 위치가 네트워크 지터에 그대로 노출됐다. 이 클래스는 **내 캐릭터만** 입력이
 * 오는 즉시 로컬에서 먼저 이동시키고(예측), 서버가 확정한 위치가 도착하면 그 시점으로
 * 되감아 그 이후 입력을 다시 재생해(재조정) 서서히 맞춰 나간다 — 화면은 절대 네트워크
 * 도착 시각을 기다리지 않는다.
 *
 * 서버(`World.movePlayer`)와 정확히 같은 이동/충돌 규칙(`resolvePlayerMove`,
 * `isPlayerBlocked`)을 shared/sim에서 그대로 가져다 쓴다 — 규칙이 어긋나면 예측이
 * 계속 빗나가 매번 되당김(rubber-banding)이 보인다.
 *
 * 스프린트(속도 1.6배)는 반영한다 — 클라이언트가 이미 그 키 상태를 알고 있어서
 * (`InputController`가 서버로 보내는 바로 그 입력에 실려 있다) 별도 정보 없이도
 * 정확히 예측할 수 있다. **알려진 한계**: 스태미나 보너스(영구 스탯)와 소모품
 * 속도 버프는 `PlayerView`에 실려 오지 않아 예측이 배율 1로 계산한다(스프린트
 * 자체의 스태미나 고갈 여부도 마찬가지) — 그 상태일 때만 예측이 서버보다 살짝
 * 어긋났다가 재조정 때 보정된다(짧은 되당김, docs/backend/55 "다음 작업" 참고).
 *
 * **`applyInput`은 입력 전송 주기(60Hz)에만 맞춰 위치를 전진시킨다** — 서버와 정확히
 * 같은 고정 스텝을 유지해야 재조정 재생이 어긋나지 않기 때문이다. 그런데 렌더 루프는
 * 이 주기와 무관하게(브라우저 주사율만큼, 60Hz 넘는 모니터면 더 자주) 돈다 — 그대로
 * `position`을 매 프레임 그리면, 두 주기가 어긋나는 프레임마다 위치가 멈춰 있다가
 * 한 스텝씩 튀는 계단식 움직임(버벅임)으로 보인다. `renderPosition()`이 이 간극을
 * 메운다 — 마지막으로 적용한 입력 방향으로, 그 이후 지난 시간만큼 짧게 미리 내다봐서
 * 그린다(예측의 "기준점"(`x`/`y`, 재조정용)은 안 건드리는 순수 화면용 값이다).
 */
export class PlayerPredictor {
  private x: number;
  private y: number;
  private readonly pending: PendingInput[] = [];
  private lastReconciledSeq = -1;
  /** renderPosition()이 내다보는 기준 — 마지막으로 적용한 입력의 시각·방향·배율. */
  private lastStepTime: number;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private lastSpeedMultiplier = 1;

  constructor(startX: number, startY: number, now: number = performance.now()) {
    this.x = startX;
    this.y = startY;
    this.lastStepTime = now;
  }

  /** 예측의 기준점(재조정이 참조하는 값) — 렌더링에는 `renderPosition()`을 쓴다. */
  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  /** 서버로 입력을 보내는 바로 그 순간 같이 호출한다 — 로컬 위치를 즉시 한 스텝 전진시킨다. */
  applyInput(
    seq: number,
    moveX: number,
    moveY: number,
    speedMultiplier: number,
    isBlocked: (x: number, y: number) => boolean,
    now: number = performance.now(),
  ): void {
    const next = resolvePlayerMove(this.x, this.y, moveX, moveY, FIXED_DT_SECONDS, speedMultiplier, isBlocked);
    this.x = next.x;
    this.y = next.y;
    this.lastStepTime = now;
    this.lastMoveX = moveX;
    this.lastMoveY = moveY;
    this.lastSpeedMultiplier = speedMultiplier;

    this.pending.push({ seq, moveX, moveY, speedMultiplier });
    if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
  }

  /**
   * 매 렌더 프레임 이걸로 그린다(`position`이 아니라). 마지막으로 적용한 입력
   * 방향·배율로, 그 이후 지난 시간만큼(최대 `MAX_RENDER_LOOKAHEAD_MS`) 미리 내다본
   * 위치를 계산만 하고 돌려준다 — 예측 기준점(`x`/`y`)은 그대로 둔다. 다음 입력이
   * 전송되면 `applyInput`이 그 시점 기준점을 실제로 전진시키므로, 그 사이 프레임마다
   * 다시 계산해도 결과가 자연스럽게 이어진다.
   */
  renderPosition(isBlocked: (x: number, y: number) => boolean, now: number = performance.now()): {
    x: number;
    y: number;
  } {
    const elapsedMs = Math.min(now - this.lastStepTime, MAX_RENDER_LOOKAHEAD_MS);
    if (elapsedMs <= 0) return { x: this.x, y: this.y };
    return resolvePlayerMove(
      this.x,
      this.y,
      this.lastMoveX,
      this.lastMoveY,
      elapsedMs / 1000,
      this.lastSpeedMultiplier,
      isBlocked,
    );
  }

  /**
   * 새 스냅샷이 도착해 서버가 인정한 `(serverSeq, serverX, serverY)`를 받을 때마다
   * 호출한다. 이미 처리한 seq면 아무것도 안 한다(매 렌더 프레임 호출돼도 안전).
   */
  reconcile(
    serverSeq: number,
    serverX: number,
    serverY: number,
    isBlocked: (x: number, y: number) => boolean,
  ): void {
    if (serverSeq <= this.lastReconciledSeq) return;
    this.lastReconciledSeq = serverSeq;

    while (this.pending.length > 0 && this.pending[0]!.seq <= serverSeq) this.pending.shift();

    this.x = serverX;
    this.y = serverY;
    for (const input of this.pending) {
      const next = resolvePlayerMove(
        this.x,
        this.y,
        input.moveX,
        input.moveY,
        FIXED_DT_SECONDS,
        input.speedMultiplier,
        isBlocked,
      );
      this.x = next.x;
      this.y = next.y;
    }
  }
}
