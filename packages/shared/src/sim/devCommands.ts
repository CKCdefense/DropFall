import { craftingData, itemsData, monstersData, shopData, wavesData, type MonsterType } from '../data';

/**
 * 개발자 커맨드.
 *
 * 모든 아이템·무기를 실제로 손에 들고 확인하려면 정상 진행(캐고 → 모으고 → 만들고 →
 * 사고)을 다 거쳐야 하는데, 밸런스나 렌더링을 보려는 것뿐일 때는 그게 전부 방해다.
 * 이 모듈은 **월드 상태를 직접 건드리는 치트 한 묶음**을 문자열 명령으로 노출한다.
 *
 * 여기 있는 건 파싱과 명령표뿐이다 — 실제 상태 변경은 `DevWorldAccess`가 하고,
 * World가 그 구현을 넘긴다. 이렇게 나눠두면 World가 이 치트들 때문에 부풀지 않고,
 * 명령표만 따로 테스트할 수 있다.
 *
 * **켜지는 조건은 이 모듈이 정하지 않는다.** 호출하는 쪽(로컬 모드, 또는 개발 플래그가
 * 켜진 서버)이 판단한다 — 여기서 켜고 끄면 "어디서 켜졌는지"가 흩어진다.
 */

/** 명령 하나가 월드에 할 수 있는 일. World가 이 구현을 만들어 넘긴다. */
export interface DevWorldAccess {
  /** 인벤토리에 넣는다. 넣지 못한 개수를 돌려준다(칸이 모자랄 때). */
  giveToInventory(playerId: string, itemId: string, count: number): number;
  /** 창고에 넣는다. 넣지 못한 개수를 돌려준다. */
  giveToStorage(itemId: string, count: number): number;
  /** 플레이어 발밑에 떨어뜨린다. */
  dropAtPlayer(playerId: string, itemId: string, count: number): void;
  clearInventory(playerId: string): void;
  clearStorage(): void;

  /** 실제로 적용된 값을 돌려준다(게이지 상한에서 잘린다). */
  setResource(amount: number): number;
  setEnergy(amount: number): number;
  /** 실제로 적용된 레벨을 돌려준다. */
  setLevel(playerId: string, level: number): number;
  /** 실제로 적용된 티어를 돌려준다(범위를 벗어나면 잘린다). */
  setTier(tier: number): number;

  /** 성공하면 true. 범위 밖 웨이브면 false. */
  jumpToWave(waveNumber: number): boolean;
  /** 낮으로 되돌린다(밤 중이면 몬스터를 치우고 다음 낮으로). */
  forceDay(): void;
  spawnMonsters(type: MonsterType, count: number): void;
  clearMonsters(): void;

  healPlayer(playerId: string): void;
  /** 내 체력을 특정 값으로 정한다. 0이면 다운 상태 확인용. */
  setPlayerHp(playerId: string, amount: number): number;
  setCoreHp(amount: number): void;
  rerollShop(): void;

  /** 쿨다운/자연 트리거를 무시하고 코어 AI 페르소나 대사를 즉시 하나 큐에 넣는다(데모/QA용). */
  forceCoreVoice(): void;

  hasPlayer(playerId: string): boolean;
}

export interface DevCommandResult {
  ok: boolean;
  /** 콘솔에 그대로 출력할 한 줄(또는 여러 줄). */
  message: string;
}

interface CommandSpec {
  usage: string;
  summary: string;
  run(access: DevWorldAccess, playerId: string, args: string[]): DevCommandResult;
}

const ok = (message: string): DevCommandResult => ({ ok: true, message });
const fail = (message: string): DevCommandResult => ({ ok: false, message });

/** 개수 인자. 없으면 기본값, 숫자가 아니면 null(호출부가 사용법을 안내한다). */
function parseCount(raw: string | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  return Math.min(value, 9999);
}

/**
 * 아이템 id를 찾는다. 정확히 일치하는 게 없으면 **한글 이름으로도** 찾아본다 —
 * 콘솔에서 `give 소총`이 안 되면 매번 id 목록을 뒤져야 해서 쓸모가 없다.
 */
function resolveItemId(token: string): string | undefined {
  if (itemsData[token]) return token;
  const lowered = token.toLowerCase();
  return Object.keys(itemsData).find(
    (itemId) => itemId.toLowerCase() === lowered || itemsData[itemId]!.name === token,
  );
}

function isMonsterType(token: string): token is MonsterType {
  return Object.prototype.hasOwnProperty.call(monstersData, token);
}

/** `all`이면 전체 아이템, 아니면 하나짜리 목록. 못 찾으면 null. */
function resolveTargets(token: string | undefined): string[] | null {
  if (token === undefined) return null;
  if (token === 'all') return Object.keys(itemsData);
  const itemId = resolveItemId(token);
  return itemId ? [itemId] : null;
}

const COMMANDS: Record<string, CommandSpec> = {
  give: {
    usage: 'give <아이템|all> [개수]',
    summary: '인벤토리에 넣는다. 칸이 모자라면 남은 만큼은 창고로 간다.',
    run(access, playerId, args) {
      const targets = resolveTargets(args[0]);
      if (!targets) return fail(`그런 아이템이 없다: ${args[0] ?? '(없음)'}`);
      const count = parseCount(args[1], 1);
      if (count === null) return fail('개수는 1 이상의 정수여야 한다.');

      let overflowed = 0;
      for (const itemId of targets) {
        const leftover = access.giveToInventory(playerId, itemId, count);
        // 4칸뿐이라 `give all`은 반드시 넘친다 — 버리지 말고 창고로 흘린다.
        if (leftover > 0) overflowed += leftover - access.giveToStorage(itemId, leftover);
      }
      const suffix = overflowed > 0 ? ` (${overflowed}개는 자리가 없어 버려졌다)` : '';
      return ok(`${targets.length}종 지급${suffix}`);
    },
  },

  store: {
    usage: 'store <아이템|all> [개수]',
    summary: '코어 창고에 넣는다.',
    run(access, _playerId, args) {
      const targets = resolveTargets(args[0]);
      if (!targets) return fail(`그런 아이템이 없다: ${args[0] ?? '(없음)'}`);
      const count = parseCount(args[1], 1);
      if (count === null) return fail('개수는 1 이상의 정수여야 한다.');

      let overflowed = 0;
      for (const itemId of targets) overflowed += access.giveToStorage(itemId, count);
      const suffix = overflowed > 0 ? ` (${overflowed}개는 창고가 꽉 차 버려졌다)` : '';
      return ok(`창고에 ${targets.length}종 입고${suffix}`);
    },
  },

  drop: {
    usage: 'drop <아이템> [개수]',
    summary: '발밑에 떨어뜨린다(줍기·렌더 확인용).',
    run(access, playerId, args) {
      const targets = resolveTargets(args[0]);
      if (!targets) return fail(`그런 아이템이 없다: ${args[0] ?? '(없음)'}`);
      const count = parseCount(args[1], 1);
      if (count === null) return fail('개수는 1 이상의 정수여야 한다.');

      for (const itemId of targets) access.dropAtPlayer(playerId, itemId, count);
      return ok(`${targets.length}종을 바닥에 떨어뜨렸다`);
    },
  },

  clear: {
    usage: 'clear [inv|store|all]',
    summary: '인벤토리/창고를 비운다(기본 inv).',
    run(access, playerId, args) {
      const target = args[0] ?? 'inv';
      if (target === 'inv' || target === 'all') access.clearInventory(playerId);
      if (target === 'store' || target === 'all') access.clearStorage();
      if (target !== 'inv' && target !== 'store' && target !== 'all') {
        return fail('대상은 inv / store / all 중 하나다.');
      }
      return ok(`비웠다: ${target}`);
    },
  },

  resource: {
    usage: 'resource <양>',
    summary: '코어 자원 게이지를 정한다(건축·제작·수리 재화).',
    run(access, _playerId, args) {
      const amount = parseCount(args[0], 1000);
      if (amount === null) return fail('양은 1 이상의 정수여야 한다.');
      return ok(`자원 ${access.setResource(amount)}`);
    },
  },

  energy: {
    usage: 'energy <양>',
    summary: '코어 에너지 게이지를 정한다(강화·상점 재화).',
    run(access, _playerId, args) {
      const amount = parseCount(args[0], 200);
      if (amount === null) return fail('양은 1 이상의 정수여야 한다.');
      return ok(`에너지 ${access.setEnergy(amount)}`);
    },
  },

  level: {
    usage: 'level <레벨>',
    summary: '내 레벨을 정한다(레벨업 보상·SP 확인용).',
    run(access, playerId, args) {
      const level = parseCount(args[0], 5);
      if (level === null) return fail('레벨은 1 이상의 정수여야 한다.');
      return ok(`레벨 ${access.setLevel(playerId, level)}`);
    },
  },

  tier: {
    usage: 'tier <단계>',
    summary: '코어 티어를 정한다(제작 해금 확인용).',
    run(access, _playerId, args) {
      const tier = parseCount(args[0], 3);
      if (tier === null) return fail('단계는 1 이상의 정수여야 한다.');
      return ok(`코어 티어 ${access.setTier(tier)}`);
    },
  },

  wave: {
    usage: 'wave <번호>',
    summary: '해당 웨이브의 밤을 즉시 시작한다.',
    run(access, _playerId, args) {
      const waveNumber = parseCount(args[0], 1);
      if (waveNumber === null) return fail('웨이브 번호는 1 이상의 정수여야 한다.');
      if (!access.jumpToWave(waveNumber)) {
        return fail(`웨이브 ${waveNumber}로 갈 수 없다(1~${wavesData.waves.length}, 승패 후엔 불가).`);
      }
      return ok(`웨이브 ${waveNumber} 시작`);
    },
  },

  day: {
    usage: 'day',
    summary: '몬스터를 치우고 낮으로 되돌린다(상점 로테이션도 새로 뽑힌다).',
    run(access) {
      access.forceDay();
      return ok('낮으로 되돌렸다');
    },
  },

  voice: {
    usage: 'voice',
    summary: '쿨다운 무시하고 코어 AI 대사를 즉시 하나 요청한다(데모/QA용).',
    run(access) {
      access.forceCoreVoice();
      return ok('코어에게 말을 걸었다');
    },
  },

  spawn: {
    usage: `spawn <${Object.keys(monstersData).join('|')}> [마리]`,
    summary: '몬스터를 코어 주변에 소환한다.',
    run(access, _playerId, args) {
      const type = args[0];
      if (type === undefined || !isMonsterType(type)) {
        return fail(`몬스터 종류: ${Object.keys(monstersData).join(', ')}`);
      }
      const count = parseCount(args[1], 1);
      if (count === null) return fail('마리 수는 1 이상의 정수여야 한다.');
      access.spawnMonsters(type, Math.min(count, 50));
      return ok(`${type} ${Math.min(count, 50)}마리 소환`);
    },
  },

  killall: {
    usage: 'killall',
    summary: '필드의 몬스터를 전부 지운다(보상 없음).',
    run(access) {
      access.clearMonsters();
      return ok('몬스터를 전부 지웠다');
    },
  },

  heal: {
    usage: 'heal',
    summary: '내 체력을 가득 채운다.',
    run(access, playerId) {
      access.healPlayer(playerId);
      return ok('체력 회복');
    },
  },

  hp: {
    usage: 'hp <값>',
    summary: '내 체력을 정한다(0이면 다운). 보스 피해량 확인용.',
    run(access, playerId, args) {
      // 0을 허용해야 "다운 → 부활" 흐름을 확인할 수 있어서 parseCount(최소 1)를 안 쓴다.
      const raw = Number(args[0]);
      if (!Number.isInteger(raw) || raw < 0) return fail('값은 0 이상의 정수여야 한다.');
      const applied = access.setPlayerHp(playerId, raw);
      return ok(`체력 ${applied}`);
    },
  },

  corehp: {
    usage: 'corehp <값>',
    summary: '코어 체력을 정한다(수리 아이템 확인용).',
    run(access, _playerId, args) {
      const amount = parseCount(args[0], 1);
      if (amount === null) return fail('값은 1 이상의 정수여야 한다.');
      access.setCoreHp(amount);
      return ok(`코어 체력 ${amount}`);
    },
  },

  shop: {
    usage: 'shop',
    summary: '상점 진열을 다시 뽑는다(등급 로테이션 확인용).',
    run(access) {
      access.rerollShop();
      return ok('상점 진열을 새로 뽑았다');
    },
  },

  list: {
    usage: 'list <items|weapons|consumables|recipes|monsters|shop>',
    summary: 'id 목록을 보여준다.',
    run(_access, _playerId, args) {
      const what = args[0] ?? 'items';
      const byKind = (kind: string): string =>
        Object.keys(itemsData)
          .filter((itemId) => itemsData[itemId]!.kind === kind)
          .join(' ');

      switch (what) {
        case 'items':
          return ok(Object.keys(itemsData).join(' '));
        case 'weapons':
          return ok(byKind('weapon'));
        case 'consumables':
          return ok(byKind('consumable'));
        case 'recipes':
          return ok(craftingData.recipes.map((recipe) => recipe.id).join(' '));
        case 'monsters':
          return ok(Object.keys(monstersData).join(' '));
        case 'shop':
          return ok(
            `무기 ${shopData.weaponsPerDay} + 소모품 ${shopData.consumablesPerDay} / 등급 가중치 ` +
              Object.entries(shopData.rarityWeights)
                .map(([rarity, weight]) => `${rarity}:${weight}`)
                .join(' '),
          );
        default:
          return fail('items / weapons / consumables / recipes / monsters / shop 중 하나.');
      }
    },
  },
};

/** 도움말은 명령표에서 만든다 — 명령을 추가하고 도움말을 잊는 일이 없도록. */
function helpText(): string {
  const lines = Object.values(COMMANDS).map((spec) => `  ${spec.usage.padEnd(34)}${spec.summary}`);
  lines.push(`  ${'help'.padEnd(34)}이 목록`);
  return ['개발자 커맨드:', ...lines].join('\n');
}

/**
 * 한 줄을 실행한다. 앞의 `/`는 있어도 되고 없어도 된다.
 *
 * 실패해도 예외를 던지지 않고 결과 문자열로 알린다 — 콘솔에 오타를 쳤다고 게임이
 * 멈추면 안 된다.
 */
export function runDevCommand(
  access: DevWorldAccess,
  playerId: string,
  line: string,
): DevCommandResult {
  const tokens = line.trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
  const name = tokens[0]?.toLowerCase();
  if (name === undefined) return fail('명령을 입력하라. `help`로 목록을 볼 수 있다.');
  if (name === 'help') return ok(helpText());

  const spec = COMMANDS[name];
  if (!spec) return fail(`모르는 명령: ${name} (help로 목록 확인)`);
  if (!access.hasPlayer(playerId)) return fail('플레이어가 월드에 없다.');

  return spec.run(access, playerId, tokens.slice(1));
}

/** 콘솔 자동완성용. 명령 이름 목록. */
export const DEV_COMMAND_NAMES = [...Object.keys(COMMANDS), 'help'];
