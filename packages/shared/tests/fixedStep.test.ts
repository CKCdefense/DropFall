import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../src/sim/fixedStep';

const STEP = 1 / 60;

describe('FixedStepAccumulator', () => {
  it('스텝 하나에 못 미치는 시간은 아직 돌리지 않는다', () => {
    const stepper = new FixedStepAccumulator(STEP);
    expect(stepper.consume(STEP / 2)).toBe(0);
  });

  it('남은 시간을 이월해서 오차가 쌓이지 않는다', () => {
    const stepper = new FixedStepAccumulator(STEP);

    // 스텝의 60%씩 두 번 = 120% → 두 번째 호출에서 한 스텝
    expect(stepper.consume(STEP * 0.6)).toBe(0);
    expect(stepper.consume(STEP * 0.6)).toBe(1);
  });

  it('타이머가 밀리면 밀린 만큼 여러 번 돌려 따라잡는다', () => {
    const stepper = new FixedStepAccumulator(STEP);
    expect(stepper.consume(STEP * 3)).toBe(3);
  });

  it('오래 실행해도 실제 시간과 시뮬레이션 시간이 어긋나지 않는다', () => {
    const stepper = new FixedStepAccumulator(STEP);

    // 60Hz를 요청했지만 실제로는 17.3ms마다 불리는 상황(늘 조금씩 늦음)
    let steps = 0;
    const callSeconds = 0.0173;
    const calls = 600;
    for (let i = 0; i < calls; i += 1) steps += stepper.consume(callSeconds);

    const realSeconds = callSeconds * calls;
    const simulatedSeconds = steps * STEP;
    // 고정값으로 틱했다면 600 * (1/60) = 10초로, 실제 10.38초보다 4% 느려진다.
    expect(simulatedSeconds).toBeCloseTo(realSeconds, 1);
  });

  it('한 번에 따라잡는 스텝 수에 상한이 있다(악순환 방지)', () => {
    const stepper = new FixedStepAccumulator(STEP, 5);
    // 탭이 1초간 멈춰 있었다 → 60스텝이 밀렸지만 5개만 돌린다
    expect(stepper.consume(1)).toBe(5);
  });

  it('상한을 넘겨 버린 시간은 이월하지 않는다', () => {
    const stepper = new FixedStepAccumulator(STEP, 5);
    stepper.consume(1);

    // 이월했다면 다음 호출에서도 상한에 걸려 계속 밀린다 — 한 스텝만 나와야 정상이다.
    expect(stepper.consume(STEP)).toBe(1);
  });

  it('시계가 뒤로 가거나 값이 이상해도 누적을 오염시키지 않는다', () => {
    const stepper = new FixedStepAccumulator(STEP);

    expect(stepper.consume(-5)).toBe(0);
    expect(stepper.consume(NaN)).toBe(0);
    expect(stepper.consume(0)).toBe(0);
    expect(stepper.consume(STEP)).toBe(1);
  });

  it('step은 tick()에 넘길 스텝 크기를 그대로 돌려준다', () => {
    expect(new FixedStepAccumulator(STEP).step).toBe(STEP);
  });
});
