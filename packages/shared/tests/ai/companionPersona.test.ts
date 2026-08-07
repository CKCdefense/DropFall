import { describe, expect, it } from 'vitest';
import { World } from '../../src/sim/world';
import {
  applyCompanionPersonaEvent,
  buildCompanionPersonaPrompt,
  createInitialCompanionTraits,
  parseCompanionMention,
  pickCompanionFallbackLine,
} from '../../src/sim/companionPersona';
import type { CompanionEntity } from '../../src/sim/companion';
import { companionData } from '../../src/data';

/** 매번 같은 시퀀스를 내는 결정론적 rng — corePersona.test.ts와 동일 패턴. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function createTestWorld(): World {
  return new World({ rng: seededRng(1) });
}

/** 테스트에서만 쓰는 mutable 캐스트 — companion.test.ts와 동일 패턴. */
function mutableCompanion(world: World): CompanionEntity {
  return world.getCompanion() as CompanionEntity;
}

describe('applyCompanionPersonaEvent — 이벤트별 트레잇 델타 적용', () => {
  it('coreDeposit은 trust와 efficiency를 올린다', () => {
    const traits = applyCompanionPersonaEvent(createInitialCompanionTraits(), 'coreDeposit');
    expect(traits.trust).toBe(companionData.persona.eventWeights.coreDeposit.trust);
    expect(traits.efficiency).toBe(companionData.persona.eventWeights.coreDeposit.efficiency);
    expect(traits.recklessness).toBe(0);
  });

  it('traitMax/traitMin 밖으로는 절대 나가지 않는다', () => {
    let traits = createInitialCompanionTraits();
    for (let i = 0; i < 1000; i += 1) traits = applyCompanionPersonaEvent(traits, 'coreDeposit');
    expect(traits.trust).toBe(companionData.persona.traitMax);
    expect(traits.efficiency).toBe(companionData.persona.traitMax);
  });
});

describe('pickCompanionFallbackLine — LLM 실패 시 대신 뽑는 대사', () => {
  it('무드 버킷에 속한 문장 중 하나를 결정론적으로 고른다(같은 시드는 같은 결과)', () => {
    const traits = { trust: companionData.persona.moodThreshold, efficiency: 0, recklessness: 0 };
    const lineA = pickCompanionFallbackLine(traits, seededRng(7));
    const lineB = pickCompanionFallbackLine(traits, seededRng(7));
    expect(lineA).toBe(lineB);
    expect(companionData.persona.fallbackLines.warm).toContain(lineA);
  });
});

describe('buildCompanionPersonaPrompt — 코어와 달리 개인 트레잇/화자가 티모시다', () => {
  it('프롬프트에 티모시 이름과 이벤트 웨이브 번호가 들어간다', () => {
    const { system, messages } = buildCompanionPersonaPrompt({
      kind: 'coreDeposit',
      playerId: 'p1',
      traits: createInitialCompanionTraits(),
      wave: 3,
    });
    expect(system).toContain(companionData.name);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toContain('3');
  });
});

describe('parseCompanionMention — "@티모시 ..." 채팅 파싱', () => {
  it('이름으로 시작하면 그 뒤 내용을 돌려준다', () => {
    expect(parseCompanionMention(`@${companionData.name} 밥 먹었냐`)).toBe('밥 먹었냐');
  });

  it('멘션이 없으면 null', () => {
    expect(parseCompanionMention('그냥 채팅임')).toBeNull();
  });

  it('이름만 있고 뒤에 내용이 없으면 null', () => {
    expect(parseCompanionMention(`@${companionData.name}`)).toBeNull();
    expect(parseCompanionMention(`@${companionData.name}   `)).toBeNull();
  });
});

describe('buildCompanionPersonaPrompt — playerMessage는 실제 문장을 그대로 건다', () => {
  it('event.message가 있으면 마지막 메시지에 그 문장이 그대로 들어간다', () => {
    const { messages } = buildCompanionPersonaPrompt({
      kind: 'playerMessage',
      playerId: 'p1',
      traits: createInitialCompanionTraits(),
      wave: 1,
      message: '밥 먹었냐',
    });
    expect(messages.at(-1)!.content).toContain('밥 먹었냐');
  });

  it('event.history가 있으면 그대로 앞에 이어 붙인다(대화 맥락 유지)', () => {
    const history = [
      { role: 'user' as const, content: '나 방금 나무 캤어' },
      { role: 'assistant' as const, content: '오, 잘했어!' },
    ];
    const { messages } = buildCompanionPersonaPrompt({
      kind: 'playerMessage',
      playerId: 'p1',
      traits: createInitialCompanionTraits(),
      wave: 1,
      message: '아까 내가 뭐 캤다고 했지?',
      history,
    });
    expect(messages.slice(0, 2)).toEqual(history);
    expect(messages.at(-1)!.content).toContain('아까 내가 뭐 캤다고 했지?');
  });
});

describe('World — "@티모시 ..." 채팅 직접 말 걸기', () => {
  it('sendCompanionMessage는 message가 채워진 playerMessage 이벤트를 쌓는다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    expect(world.sendCompanionMessage('p1', '밥 먹었냐')).toBe(true);
    const events = world.drainCompanionPersonaEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('playerMessage');
    expect(events[0]!.playerId).toBe('p1');
    expect(events[0]!.message).toBe('밥 먹었냐');
  });

  it('존재하지 않는 플레이어면 거절한다', () => {
    const world = createTestWorld();
    expect(world.sendCompanionMessage('ghost', '밥 먹었냐')).toBe(false);
    expect(world.drainCompanionPersonaEvents()).toHaveLength(0);
  });

  it('거리 제한이 없다 — 티모시와 멀리 떨어져 있어도 통한다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 5000, 5000);
    expect(world.sendCompanionMessage('p1', '밥 먹었냐')).toBe(true);
  });

  it('전용 쿨다운은 잡담(interactionCooldownSeconds) 쿨다운과 서로 방해하지 않는다', () => {
    const world = createTestWorld();
    const spawn = world.getCompanion();
    world.addPlayer('p1', spawn.x, spawn.y);

    // 잡담 쿨다운을 먼저 소모해도(proximityInteract) 직접 말 걸기는 막히지 않는다.
    world.requestCompanionInteraction('p1');
    world.drainCompanionPersonaEvents();
    expect(world.sendCompanionMessage('p1', '밥 먹었냐')).toBe(true);
    expect(world.drainCompanionPersonaEvents()).toHaveLength(1);

    // 반대로 방금 쓴 playerMessage 쿨다운 안에서는 두 번째 직접 말 걸기가 거절된다.
    expect(world.sendCompanionMessage('p1', '또 물어봄')).toBe(false);
    expect(world.drainCompanionPersonaEvents()).toHaveLength(0);

    world.tick(companionData.persona.playerMessageCooldownSeconds + 0.1);
    expect(world.sendCompanionMessage('p1', '다시 물어봄')).toBe(true);
  });
});

describe('World — "@티모시 ..." 대화 기록(메모리)', () => {
  it('처음 말 걸 때는 history가 비어 있다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    world.sendCompanionMessage('p1', '밥 먹었냐');
    const [event] = world.drainCompanionPersonaEvents();
    expect(event!.history).toEqual([]);
  });

  it('sendCompanionMessage는 이번 메시지를 user 턴으로 기록에 남긴다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    world.sendCompanionMessage('p1', '밥 먹었냐');
    expect(world.getCompanionHistory('p1')).toEqual([{ role: 'user', content: '밥 먹었냐' }]);
  });

  it('recordCompanionReply는 assistant 턴을 이어 붙인다 — 다음 메시지의 history에 둘 다 보인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);

    world.sendCompanionMessage('p1', '밥 먹었냐');
    world.recordCompanionReply('p1', '로봇이라 안 먹어');
    world.tick(companionData.persona.playerMessageCooldownSeconds + 0.1);
    world.sendCompanionMessage('p1', '진짜?');

    const events = world.drainCompanionPersonaEvents();
    const secondEvent = events.find((e) => e.message === '진짜?');
    expect(secondEvent!.history).toEqual([
      { role: 'user', content: '밥 먹었냐' },
      { role: 'assistant', content: '로봇이라 안 먹어' },
    ]);
  });

  it('플레이어별로 대화 기록이 따로 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    world.addPlayer('p2', 0, 0);

    world.sendCompanionMessage('p1', 'p1이 말함');
    // playerMessageCooldownSeconds는 플레이어별이 아니라 방 전역이라(스팸 방지 공용 풀),
    // 연달아 다른 플레이어가 말 걸어도 쿨다운을 넘겨야 한다.
    world.tick(companionData.persona.playerMessageCooldownSeconds + 0.1);
    world.sendCompanionMessage('p2', 'p2가 말함');

    expect(world.getCompanionHistory('p1')).toEqual([{ role: 'user', content: 'p1이 말함' }]);
    expect(world.getCompanionHistory('p2')).toEqual([{ role: 'user', content: 'p2가 말함' }]);
  });

  it('historyMessageLimit을 넘으면 오래된 것부터 잘려나간다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const limit = companionData.persona.historyMessageLimit;

    for (let i = 0; i < limit; i += 1) {
      world.sendCompanionMessage('p1', `메시지${i}`);
      world.recordCompanionReply('p1', `답${i}`);
      world.tick(companionData.persona.playerMessageCooldownSeconds + 0.1);
    }

    expect(world.getCompanionHistory('p1').length).toBe(limit);
    // 가장 최근 것들만 남아 있어야 한다 — 맨 처음 메시지는 잘려나갔다.
    expect(world.getCompanionHistory('p1')[0]).not.toEqual({ role: 'user', content: '메시지0' });
  });
});

describe('World — 티모시 대사 트리거', () => {
  it('창고에 자원을 납품하면(moveItem) coreDeposit 이벤트가 그 플레이어를 향해 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0); // 코어 상호작용 반경 안
    world.moveItem('p1', 'storage', 3, 'inventory', 0); // 붕대 꺼내기(입고 아님 — 이벤트 없어야 한다)
    expect(world.drainCompanionPersonaEvents()).toHaveLength(0);

    world.moveItem('p1', 'inventory', 0, 'storage', 4); // 다시 입고 — coreDeposit

    const events = world.drainCompanionPersonaEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('coreDeposit');
    expect(events[0]!.playerId).toBe('p1');
  });

  it('창고에 자원을 납품하면(quickMoveItem) 마찬가지로 이벤트가 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 10, 0);
    world.moveItem('p1', 'storage', 3, 'inventory', 0);
    world.drainCompanionPersonaEvents(); // 위 withdraw는 이벤트 없음 — 큐만 비워둔다

    world.quickMoveItem('p1', 'inventory', 0); // 인벤토리 → 창고(반대편 자동)

    const events = world.drainCompanionPersonaEvents();
    expect(events.some((e) => e.kind === 'coreDeposit' && e.playerId === 'p1')).toBe(true);
  });

  it('티모시 옆(interactRange 안)에서 상호작용하면 proximityInteract 이벤트가 쌓인다', () => {
    const world = createTestWorld();
    const spawn = world.getCompanion();
    world.addPlayer('p1', spawn.x, spawn.y);

    expect(world.requestCompanionInteraction('p1')).toBe(true);
    const events = world.drainCompanionPersonaEvents();
    expect(events.some((e) => e.kind === 'proximityInteract' && e.playerId === 'p1')).toBe(true);
  });

  it('사거리 밖이면 상호작용이 거부되고 이벤트도 안 쌓인다', () => {
    const world = createTestWorld();
    const spawn = world.getCompanion();
    world.addPlayer('p1', spawn.x + companionData.interactRange + 100, spawn.y);

    expect(world.requestCompanionInteraction('p1')).toBe(false);
    expect(world.drainCompanionPersonaEvents()).toHaveLength(0);
  });

  it('티모시가 몬스터에게 맞아 다운되면 가장 가까운 플레이어를 향해 companionDowned가 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    world.runDevCommand('p1', 'spawn trash 1');
    const [monster] = [...world.getMonsters().values()];
    const companion = mutableCompanion(world);
    companion.x = monster.x;
    companion.y = monster.y;
    companion.hp = 1;

    world.tick(0.1);

    const events = world.drainCompanionPersonaEvents();
    expect(events.some((e) => e.kind === 'companionDowned' && e.playerId === 'p1')).toBe(true);
  });

  it('낮이 시작돼 다운된 티모시가 리셋되면 companionRevived가 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    const companion = mutableCompanion(world);
    companion.state = 'downed';
    companion.hp = 0;

    world.runDevCommand('p1', 'wave 1');
    world.runDevCommand('p1', 'day');

    const events = world.drainCompanionPersonaEvents();
    expect(events.some((e) => e.kind === 'companionRevived' && e.playerId === 'p1')).toBe(true);
  });

  it('웨이브가 끝나면 티모시와 가장 가까운 플레이어를 향해 waveEnd가 쌓인다', () => {
    const world = createTestWorld();
    world.addPlayer('p1', 0, 0);
    world.runDevCommand('p1', 'wave 1');
    world.runDevCommand('p1', 'day');

    const events = world.drainCompanionPersonaEvents();
    expect(events.some((e) => e.kind === 'waveEnd' && e.playerId === 'p1')).toBe(true);
  });

  it('방 전역 쿨다운 안에서는 트레잇은 쌓여도 새 대사 이벤트는 큐에 안 들어간다', () => {
    const world = createTestWorld();
    const spawn = world.getCompanion();
    world.addPlayer('p1', spawn.x, spawn.y);

    expect(world.requestCompanionInteraction('p1')).toBe(true);
    world.drainCompanionPersonaEvents();

    // 쿨다운 안 — 상호작용 자체는 "성공"(사거리 안)이지만 대사 큐엔 안 쌓인다.
    world.requestCompanionInteraction('p1');
    expect(world.drainCompanionPersonaEvents()).toHaveLength(0);

    world.tick(companionData.persona.interactionCooldownSeconds + 0.1);
    world.requestCompanionInteraction('p1');
    expect(world.drainCompanionPersonaEvents()).toHaveLength(1);
  });
});
