import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';

describe('World', () => {
  it('입력받은 방향으로 tick 이후 플레이어가 이동한다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.setInput('p1', { seq: 1, moveX: 1, moveY: 0, aimAngle: 0 });

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBeGreaterThan(0);
    expect(player?.y).toBe(0);
  });

  it('입력이 없는 플레이어는 이동하지 않는다', () => {
    const world = new World();
    world.addPlayer('p1', 5, 5);

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player).toEqual({ id: 'p1', x: 5, y: 5, aimAngle: 0, lastProcessedSeq: 0 });
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
    world.addPlayer('p1', 0, 0);
    world.setInput('p1', { seq: 1, moveX: 999, moveY: -999, aimAngle: 0 });

    world.tick(1);

    const player = world.getPlayers().get('p1');
    expect(player?.x).toBe(100); // PLAYER_SPEED(100) * clamp(999→1) * 1s
    expect(player?.y).toBe(-100);
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
