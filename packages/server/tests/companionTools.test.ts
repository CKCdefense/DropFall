import { describe, expect, it } from 'vitest';
import { World } from '@dropfall/shared';
import { COMPANION_TOOLS, executeCompanionTool } from '../src/persona/companionTools';

function createWorld(): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  return world;
}

describe('COMPANION_TOOLS — 도구 정의 형태', () => {
  it('이름이 서로 겹치지 않는다(모델이 헷갈릴 여지가 없어야 한다)', () => {
    const names = COMPANION_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('전부 name/description/input_schema를 갖춘다', () => {
    for (const tool of COMPANION_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeTruthy();
    }
  });
});

describe('executeCompanionTool', () => {
  it('get_storage는 창고의 나무/돌/부품 개수를 그대로 돌려준다', () => {
    const world = createWorld();
    world.runDevCommand('p1', 'store wood 7');
    world.runDevCommand('p1', 'store stone 3');

    const result = executeCompanionTool(world, 'get_storage') as {
      wood: number;
      stone: number;
      parts: number;
    };

    expect(result.wood).toBe(7);
    expect(result.stone).toBe(3);
    expect(result.parts).toBe(0);
  });

  it('get_wave_status는 현재 웨이브/페이즈/남은 시간을 돌려준다', () => {
    const world = createWorld();

    const result = executeCompanionTool(world, 'get_wave_status') as {
      wave: number;
      phase: string;
      phaseTimeRemainingSeconds: number;
    };

    expect(result.wave).toBe(world.getCurrentWave());
    expect(result.phase).toBe(world.getWavePhase());
    expect(typeof result.phaseTimeRemainingSeconds).toBe('number');
  });

  it('get_companion_status는 티모시 자신의 체력/소지 자원/상태를 돌려준다', () => {
    const world = createWorld();

    const result = executeCompanionTool(world, 'get_companion_status') as {
      hp: number;
      maxHp: number;
      carriedWood: number;
      carriedStone: number;
      state: string;
    };

    const companion = world.getCompanion();
    expect(result.hp).toBe(companion.hp);
    expect(result.maxHp).toBe(companion.maxHp);
    expect(result.carriedWood).toBe(0);
    expect(result.carriedStone).toBe(0);
    expect(result.state).toBe(companion.state);
  });

  it('모르는 도구 이름이면 예외를 던지지 않고 에러 객체를 돌려준다', () => {
    const world = createWorld();

    const result = executeCompanionTool(world, 'delete_everything') as { error: string };

    expect(result.error).toContain('delete_everything');
  });
});
