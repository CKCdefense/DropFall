import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { jobsData } from '../src/data';
import { PLAYER_SPEED } from '../src/sim/movement';

/**
 * 이동 테스트의 출발점. **코어 발자국 밖**이어야 한다 — 예전엔 원점(0,0)에서 시작했는데,
 * 이동속도를 절반으로 낮추자 1초 한 틱으로도 발자국을 못 벗어나 충돌에 막혔다.
 * 이 테스트들이 보려는 건 입력 처리이지 코어 충돌이 아니다.
 */
const START_X = 500;
const START_Y = 500;

describe('World', () => {
  it('입력받은 방향으로 tick 이후 플레이어가 이동한다', () => {
    const world = new World();
    world.addPlayer('p1', START_X, START_Y);
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBeGreaterThan(START_X);
    expect(player?.y).toBe(START_Y);
  });

  it('입력이 없는 플레이어는 이동하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 5, 5);

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player).toMatchObject({
      id: 'p1',
      x: 5,
      y: 5,
      aimAngle: 0,
      lastProcessedSeq: 0,
      hp: jobsData.base.maxHp,
    });
  });

  it('제거된 플레이어는 목록에서 사라진다', () => {
    const world = new World();
    world.addPlayer('p1');
    world.removePlayer('p1');

    expect(world.getPlayers().has('p1')).toBe(false);
  });

  it('tick 후 aimAngle과 lastProcessedSeq가 입력값으로 갱신된다', () => {
    const world = new World();
    world.addPlayer('p1');
    world.setInput('p1', { seq: 7, moveX: 0, moveY: 0, aimAngle: 1.57 });

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.aimAngle).toBe(1.57);
    expect(player?.lastProcessedSeq).toBe(7);
  });

  it('범위를 벗어난 moveX/moveY는 -1~1로 clamp된다', () => {
    const world = new World();
    world.addPlayer('p1', START_X, START_Y);
    world.setInput('p1', { seq: 1, moveX: 999, moveY: 0, aimAngle: 0 });

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBe(START_X + PLAYER_SPEED); // clamp(999→1) * 1s
    expect(player?.y).toBe(START_Y);
  });

  it('대각선 입력도 직선과 같은 속도로 이동한다', () => {
    const straight = new World();
    straight.addPlayer('p1', START_X, START_Y);
    straight.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });
    straight.tick(1);

    const diagonal = new World();
    diagonal.addPlayer('p1', START_X, START_Y);
    diagonal.setInput('p1', { seq: 1, moveX: 1, moveY: 1, aimAngle: 0 });
    diagonal.tick(1);

    const a = straight.getPlayers().get('p1')!;
    const b = diagonal.getPlayers().get('p1')!;

    // clamp만 하면 대각선이 √2배(약 141%) 빨라진다 — 정규화로 막는다.
    expect(Math.hypot(b.x - START_X, b.y - START_Y)).toBeCloseTo(
      Math.hypot(a.x - START_X, a.y - START_Y),
      5,
    );
  });

  it('순서가 뒤바뀌거나 중복된 seq 입력은 무시한다', () => {
    const world = new World();
    world.addPlayer('p1', START_X, START_Y);

    world.setInput('p1', { seq: 5, moveX: 1, moveY: 0, aimAngle: 1 });
    // 늦게 도착한 예전 입력. 받아들이면 lastProcessedSeq가 되감겨 클라이언트가 튄다.
    world.setInput('p1', { seq: 3, moveX: -1, moveY: 0, aimAngle: 2 });
    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.lastProcessedSeq).toBe(5);
    expect(player?.x).toBe(START_X + PLAYER_SPEED);
    expect(player?.aimAngle).toBe(1);
  });

  it('moveX가 빠지거나 숫자가 아니면 입력 전체를 무시하고 NaN으로 오염시키지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 5, 5);

    // Playground 등에서 필드 누락/오타 메시지가 올 수 있는 상황을 흉내낸다
    world.setInput('p1', { seq: 1 } as unknown as Parameters<World['setInput']>[1]);
    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBe(5);
    expect(player?.y).toBe(5);
    expect(Number.isNaN(player?.x)).toBe(false);
  });

  it('입력 자체가 undefined/null이어도 크래시하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 3, 3);

    expect(() =>
      world.setInput('p1', undefined as unknown as Parameters<World['setInput']>[1]),
    ).not.toThrow();
    expect(() =>
      world.setInput('p1', null as unknown as Parameters<World['setInput']>[1]),
    ).not.toThrow();

    world.tick(1);
    const player = world.getPlayers().get('p1');
    expect(player?.x).toBe(3);
    expect(player?.y).toBe(3);
  });

  it('NaN이 담긴 입력도 무시한다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);

    world.setInput('p1', { seq: 1, moveX: NaN, moveY: 0, aimAngle: 0 });
    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBe(0);
    expect(Number.isNaN(player?.x)).toBe(false);
  });
});
