import { describe, expect, it } from 'vitest';
import { EXPLORED_BYTE_COUNT, ExploredMap, REVEAL_RADIUS_TILES } from '../src/sim/explored';
import { MAP_SIZE_TILES, worldToCell } from '../src/constants';
import { World } from '../src/sim/world';

describe('ExploredMap', () => {
  it('처음에는 아무 곳도 밝혀져 있지 않다', () => {
    const map = new ExploredMap();

    expect(map.isExplored(0, 0)).toBe(false);
    expect(map.raw).toHaveLength(EXPLORED_BYTE_COUNT);
    expect([...map.raw].every((byte) => byte === 0)).toBe(true);
  });

  it('한 번 밝힌 칸을 다시 밝히면 false — 새로 열린 것만 세기 위해서다', () => {
    const map = new ExploredMap();

    expect(map.reveal(10, 10)).toBe(true);
    expect(map.reveal(10, 10)).toBe(false);
    expect(map.isExplored(10, 10)).toBe(true);
  });

  it('맵 밖 좌표는 무시한다(비트가 옆 칸으로 새지 않는다)', () => {
    const map = new ExploredMap();

    expect(map.reveal(-1, 0)).toBe(false);
    expect(map.reveal(MAP_SIZE_TILES, 0)).toBe(false);
    expect([...map.raw].every((byte) => byte === 0)).toBe(true);
  });

  it('원형으로 밝힌다 — 반경 안은 열리고 밖은 닫혀 있다', () => {
    const map = new ExploredMap();
    const { cx, cy } = worldToCell(0, 0);

    map.revealAround(0, 0);

    expect(map.isExplored(cx, cy)).toBe(true);
    expect(map.isExplored(cx + REVEAL_RADIUS_TILES - 1, cy)).toBe(true);
    // 반경 밖 — 사각형이 아니라 원이라 대각선 모서리도 닫혀 있어야 한다.
    expect(map.isExplored(cx + REVEAL_RADIUS_TILES + 1, cy)).toBe(false);
    expect(map.isExplored(cx + REVEAL_RADIUS_TILES, cy + REVEAL_RADIUS_TILES)).toBe(false);
  });

  it('load로 서버 상태를 그대로 이어받는다', () => {
    const source = new ExploredMap();
    source.revealAround(0, 0);

    const target = new ExploredMap();
    target.load(source.raw);

    expect([...target.raw]).toEqual([...source.raw]);
  });
});

describe('World — 탐색 안개', () => {
  it('플레이어 주변이 밝혀지고, 안 가본 곳은 어둡다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.tick(0.1);

    const explored = world.getExplored();
    const map = new ExploredMap();
    map.load(explored);

    const { cx, cy } = worldToCell(0, 0);
    expect(map.isExplored(cx, cy)).toBe(true);
    // 맵 구석은 아무도 안 갔다.
    expect(map.isExplored(2, 2)).toBe(false);
  });

  it('팀 전체가 공유한다 — 다른 사람이 밝힌 곳도 같은 비트맵에 남는다', () => {
    const world = new World();
    world.addPlayer('scout', 600, 600);
    world.tick(0.1);

    const map = new ExploredMap();
    map.load(world.getExplored());

    const far = worldToCell(600, 600);
    expect(map.isExplored(far.cx, far.cy)).toBe(true);

    // 정찰자가 나가도 밝힌 기록은 남는다.
    world.removePlayer('scout');
    world.tick(0.1);
    map.load(world.getExplored());
    expect(map.isExplored(far.cx, far.cy)).toBe(true);
  });

  it('제자리에 서 있으면 다시 계산하지 않는다(같은 칸이면 비트맵이 그대로다)', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.tick(0.1);
    const before = [...world.getExplored()];

    for (let i = 0; i < 10; i += 1) world.tick(0.1);

    expect([...world.getExplored()]).toEqual(before);
  });

  it('걸어가면 새 지역이 열린다', () => {
    const world = new World();
    world.addPlayer('p1', 0, 0);
    world.tick(0.1);
    const countBits = (): number =>
      [...world.getExplored()].reduce((sum, byte) => {
        let bits = 0;
        for (let i = 0; i < 8; i += 1) if (byte & (1 << i)) bits += 1;
        return sum + bits;
      }, 0);
    const before = countBits();

    const player = world.getPlayers().get('p1')!;
    player.x = 400;
    world.tick(0.1);

    expect(countBits()).toBeGreaterThan(before);
  });

  it('쓰러진 플레이어는 시야를 밝히지 않는다', () => {
    const world = new World();
    world.addPlayer('down', 800, -800);
    world.getPlayers().get('down')!.hp = 0;
    world.tick(0.1);

    const map = new ExploredMap();
    map.load(world.getExplored());
    const cell = worldToCell(800, -800);
    expect(map.isExplored(cell.cx, cell.cy)).toBe(false);
  });
});
