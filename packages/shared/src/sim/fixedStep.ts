/**
 * 고정 스텝 누적기.
 *
 * **왜 필요한가**
 * `setInterval(() => world.tick(1/60), 1000/60)` 처럼 "타이머가 불릴 때마다 정해진 양만큼
 * 시뮬레이션을 진행"시키면, 타이머가 늦게 오는 만큼 시간이 **영구히 사라진다**.
 * 브라우저 탭이 백그라운드로 가거나 프레임이 밀리면 게임 전체가 슬로모션이 된다 —
 * 몬스터가 느려지고, 웨이브 타이머가 늘어지고, 무기 쿨다운이 실제 시간과 어긋난다.
 * (실측: 부하 상황에서 시뮬이 실제 시간의 41% 속도로 진행됐다)
 *
 * 그래서 "실제로 흐른 시간"을 받아 누적하고, 고정 크기 스텝으로 나눠 여러 번 돌린다.
 * 스텝 크기를 고정하는 이유는 물리·이동 계산의 결정성 때문이다 — 가변 dt로 돌리면
 * 서버와 클라이언트가 같은 입력에도 다른 결과를 낸다.
 *
 * **따라잡기 상한**
 * 한 번에 무한정 따라잡으면, 느려진 상황에서 틱이 더 쌓이고 그래서 더 느려지는
 * 악순환(spiral of death)에 빠진다. 상한을 넘은 시간은 버린다 — 게임이 잠깐 느려지는 게
 * 아예 멈추는 것보다 낫다.
 */
export class FixedStepAccumulator {
  private carry = 0;

  constructor(
    /** 한 스텝의 크기(초). 보통 1 / TICK_RATE */
    private readonly stepSeconds: number,
    /** 한 번에 따라잡을 수 있는 최대 스텝 수 */
    private readonly maxStepsPerCall = 5,
  ) {}

  /**
   * 실제로 흐른 시간(초)을 넣으면 돌려야 할 스텝 수를 돌려준다.
   * 남은 시간은 다음 호출로 이월되므로 장기적으로 오차가 쌓이지 않는다.
   */
  consume(elapsedSeconds: number): number {
    // 음수/NaN은 시계가 뒤로 갔거나 첫 호출이 이상한 경우다. 누적을 오염시키지 않는다.
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;

    this.carry += elapsedSeconds;
    const steps = Math.floor(this.carry / this.stepSeconds);
    if (steps <= 0) return 0;

    if (steps > this.maxStepsPerCall) {
      // 따라잡기를 포기한 시간은 버린다. 이월하면 다음 호출에서 또 상한에 걸려 계속 밀린다.
      this.carry = 0;
      return this.maxStepsPerCall;
    }

    this.carry -= steps * this.stepSeconds;
    return steps;
  }

  /** 스텝 하나의 길이(초). 호출자가 tick()에 넘길 값이다. */
  get step(): number {
    return this.stepSeconds;
  }
}
