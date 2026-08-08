import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { coreUpgradesData, itemsData, jobsData, monstersData, wavesData } from '../src/data';
import { SLOT_COUNT } from '../src/sim/inventory';
import { STORAGE_SLOT_COUNT } from '../src/sim/storage';

function worldWithPlayer(): World {
  const world = new World();
  world.addPlayer('p1', 0, 0);
  return world;
}

function carried(world: World, itemId: string): number {
  return world.getPlayers().get('p1')!.inventory.countOf(itemId);
}

function dropped(world: World, itemId: string): number {
  let total = 0;
  for (const drop of world.getDroppedItems().values()) {
    if (drop.itemId === itemId) total += drop.count;
  }
  return total;
}

describe('개발자 커맨드 — 지급', () => {
  it('give는 인벤토리에 넣는다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'give rifle 1');

    expect(result.ok).toBe(true);
    expect(carried(world, 'rifle')).toBe(1);
  });

  it('앞에 /를 붙여도 되고 대소문자도 가리지 않는다', () => {
    const world = worldWithPlayer();

    expect(world.runDevCommand('p1', '/GIVE rifle 1').ok).toBe(true);
    expect(carried(world, 'rifle')).toBe(1);
  });

  it('한글 이름으로도 찾는다(id를 외우지 않아도 된다)', () => {
    const world = worldWithPlayer();

    // 이름에 공백이 있으면 토큰이 쪼개져 못 찾는다 — 한 낱말짜리 이름으로 확인한다.
    expect(world.runDevCommand('p1', 'give 리볼버').ok).toBe(true);
    expect(carried(world, 'revolver')).toBe(1);
  });

  it('give all은 모든 아이템을 주고, 4칸을 넘긴 몫은 창고로 간다', () => {
    const world = worldWithPlayer();
    world.runDevCommand('p1', 'clear all');

    const result = world.runDevCommand('p1', 'give all 1');

    expect(result.ok).toBe(true);
    // 아이템 종류가 인벤토리 4칸 + 창고 20칸을 넘어선다 — 들어갈 수 있는 만큼은 전부
    // 채우고, 넘친 몫은 조용히 버리지 않고 메시지로 알려준다.
    const storage = world.getCore().storage;
    const placed = Object.keys(itemsData).filter(
      (itemId) => carried(world, itemId) + storage.countOf(itemId) > 0,
    );
    expect(placed).toHaveLength(SLOT_COUNT + STORAGE_SLOT_COUNT);
    expect(result.message).toContain('자리가 없어');
  });

  it('없는 아이템은 실패하고 아무것도 안 준다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'give 없는아이템');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('없는아이템');
  });

  it('drop은 발밑에 떨어뜨린다(줍기 경로 확인용)', () => {
    const world = worldWithPlayer();

    world.runDevCommand('p1', 'drop drop_rare 3');

    expect(dropped(world, 'drop_rare')).toBe(3);
    expect(carried(world, 'drop_rare')).toBe(0);
  });

  it('clear inv는 인벤토리만 비우고 창고는 남긴다', () => {
    const world = worldWithPlayer();
    world.runDevCommand('p1', 'give rifle 1');
    world.runDevCommand('p1', 'store wood 50');

    world.runDevCommand('p1', 'clear inv');

    expect(carried(world, 'rifle')).toBe(0);
    expect(world.getCore().storage.countOf('wood')).toBe(50);
  });
});

describe('개발자 커맨드 — 자원·진행', () => {
  it('resource/energy/tier가 그대로 반영된다', () => {
    const world = worldWithPlayer();

    world.runDevCommand('p1', 'resource 300');
    world.runDevCommand('p1', 'energy 42');
    world.runDevCommand('p1', 'tier 3');

    expect(world.getCore().resource).toBe(300);
    // 게이지에는 상한이 있다 — 커맨드로도 넘길 수 없다(강화해야 늘어난다).
    world.runDevCommand('p1', 'resource 999999');
    expect(world.getCore().resource).toBe(world.getCore().maxResource);
    expect(world.getCore().energy).toBe(42);
    expect(world.getCore().tier).toBe(3);
  });

  it('tier는 최대 단계를 넘지 않는다', () => {
    const world = worldWithPlayer();
    const maxTier = coreUpgradesData.startTier + coreUpgradesData.tiers.length;

    const result = world.runDevCommand('p1', 'tier 99');

    expect(world.getCore().tier).toBe(maxTier);
    expect(result.message).toContain(String(maxTier));
  });

  it('wave는 해당 웨이브의 밤을 시작한다', () => {
    const world = worldWithPlayer();

    expect(world.runDevCommand('p1', 'wave 3').ok).toBe(true);
    expect(world.getCurrentWave()).toBe(3);
    expect(world.getWavePhase()).toBe('night');
  });

  it('범위 밖 웨이브는 거절된다', () => {
    const world = worldWithPlayer();
    const before = world.getCurrentWave();

    const result = world.runDevCommand('p1', `wave ${wavesData.waves.length + 1}`);

    expect(result.ok).toBe(false);
    expect(world.getCurrentWave()).toBe(before);
  });

  it('day는 몬스터를 치우고 낮으로 되돌린다', () => {
    const world = worldWithPlayer();
    world.runDevCommand('p1', 'wave 2');
    world.runDevCommand('p1', 'spawn demon 5');
    expect(world.getMonsters().size).toBeGreaterThan(0);

    world.runDevCommand('p1', 'day');

    expect(world.getMonsters().size).toBe(0);
    expect(world.getWavePhase()).toBe('day');
  });

  it('spawn은 요청한 마릿수를 코어에서 떨어뜨려 놓는다', () => {
    const world = worldWithPlayer();

    world.runDevCommand('p1', 'spawn lava_slime 4');

    const monsters = [...world.getMonsters().values()];
    expect(monsters).toHaveLength(4);
    expect(monsters.every((monster) => monster.type === 'lava_slime')).toBe(true);
    // 코어에 붙여 놓으면 소환하자마자 코어가 맞기 시작한다.
    expect(monsters.every((monster) => Math.hypot(monster.x, monster.y) > 100)).toBe(true);
  });

  it('모르는 몬스터 종류는 목록을 알려주고 아무것도 소환하지 않는다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'spawn 드래곤');

    expect(result.ok).toBe(false);
    expect(result.message).toContain(Object.keys(monstersData)[0]!);
    expect(world.getMonsters().size).toBe(0);
  });

  it('killall은 필드를 비운다', () => {
    const world = worldWithPlayer();
    world.runDevCommand('p1', 'spawn demon 3');

    world.runDevCommand('p1', 'killall');

    expect(world.getMonsters().size).toBe(0);
  });

  it('heal은 체력을 가득 채우고, corehp는 코어 체력을 정한다', () => {
    const world = worldWithPlayer();
    const player = world.getPlayers().get('p1')!;
    player.hp = 1;

    world.runDevCommand('p1', 'heal');
    world.runDevCommand('p1', 'corehp 500');

    expect(player.hp).toBe(jobsData.base.maxHp);
    expect(world.getCore().hp).toBe(500);
  });

  it('shop은 진열을 다시 뽑는다(규칙은 그대로 유지된다)', () => {
    const world = worldWithPlayer();

    world.runDevCommand('p1', 'shop');

    const stock = world.getCore().shopStock;
    expect(new Set(stock).size).toBe(stock.length);
    expect(stock.every((itemId) => itemsData[itemId]?.buyPrice !== undefined)).toBe(true);
  });
});

describe('개발자 커맨드 — 입력 처리', () => {
  it('help는 명령 목록을 돌려준다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'help');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('give');
    expect(result.message).toContain('spawn');
  });

  it('빈 줄이나 모르는 명령은 실패로 알리고 예외를 던지지 않는다', () => {
    const world = worldWithPlayer();

    expect(world.runDevCommand('p1', '   ').ok).toBe(false);
    expect(world.runDevCommand('p1', 'nonsense').ok).toBe(false);
    expect(() => world.runDevCommand('p1', 'give')).not.toThrow();
  });

  it('개수 인자가 숫자가 아니면 거절한다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'give rifle 두개');

    expect(result.ok).toBe(false);
    expect(carried(world, 'rifle')).toBe(0);
  });

  it('월드에 없는 플레이어의 명령은 무시된다', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('ghost', 'give rifle 1');

    expect(result.ok).toBe(false);
    expect(carried(world, 'rifle')).toBe(0);
  });

  it('list는 id 목록을 준다', () => {
    const world = worldWithPlayer();

    expect(world.runDevCommand('p1', 'list weapons').message).toContain('rifle');
    expect(world.runDevCommand('p1', 'list monsters').message).toContain('boss_dark_knight');
    expect(world.runDevCommand('p1', 'list 아무거나').ok).toBe(false);
  });
});

describe('개발자 커맨드 — 체력', () => {
  it('hp는 최대치를 넘겨서도 설정된다(보스 패턴을 끝까지 보려고 쓰는 커맨드다)', () => {
    const world = worldWithPlayer();

    const result = world.runDevCommand('p1', 'hp 1000');

    expect(result.ok).toBe(true);
    expect(world.getPlayers().get('p1')!.hp).toBe(1000);
  });

  it('hp 0은 다운 상태를 만든다', () => {
    const world = worldWithPlayer();

    expect(world.runDevCommand('p1', 'hp 0').ok).toBe(true);
    expect(world.getPlayers().get('p1')!.hp).toBe(0);
  });

  it('음수나 정수가 아닌 값은 거절한다', () => {
    const world = worldWithPlayer();
    const before = world.getPlayers().get('p1')!.hp;

    expect(world.runDevCommand('p1', 'hp -5').ok).toBe(false);
    expect(world.runDevCommand('p1', 'hp abc').ok).toBe(false);
    expect(world.runDevCommand('p1', 'hp 1.5').ok).toBe(false);
    expect(world.getPlayers().get('p1')!.hp).toBe(before);
  });
});
