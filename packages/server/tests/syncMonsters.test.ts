import { describe, expect, it } from 'vitest';
import { GameRoom } from '../src/rooms/GameRoom';
import { GameRoomState } from '../src/schema/GameRoomState';

/**
 * 실제로 겪은 버그의 회귀 테스트 — **멀티에서만** 몬스터 공격 애니메이션이 한 번도
 * 재생되지 않았다.
 *
 * 원인은 `attacking`·`attackAnim`·`attackSeq`·`facingLeft`를 `if (!schema)` 블록
 * **안에서** 대입한 것이다(들여쓰기만 바깥처럼 보였다). 스폰된 순간의 값이 그대로
 * 굳어서 몬스터는 영원히 같은 방향을 보고 attackSeq는 절대 안 바뀐다 — 클라이언트는
 * 그 번호가 **바뀌는 순간**에 공격 모션을 트니까 모션이 나올 일이 없다.
 *
 * 혼자하기는 월드 엔티티를 직접 읽어서 멀쩡했다. 그래서 로컬 검증만으로는 잡히지 않는다.
 */

/** Colyseus 런타임 없이 동기화 함수만 돌린다 — 검증 대상은 "값이 매 틱 실리는가"다. */
function roomWithMonster() {
  const room = new GameRoom() as unknown as {
    state: GameRoomState;
    world: {
      addPlayer(id: string, x?: number, y?: number): void;
      runDevCommand(playerId: string, line: string): unknown;
      getMonsters(): ReadonlyMap<string, Record<string, unknown>>;
    };
    syncMonsters(): void;
  };
  room.state = new GameRoomState();
  room.world.addPlayer('p1', 400, 400);
  room.world.runDevCommand('p1', 'spawn demon 1');
  room.syncMonsters();

  const [id, monster] = [...room.world.getMonsters().entries()][0]!;
  return { room, id, monster };
}

describe('GameRoom#syncMonsters — 동작·방향은 매 틱 실린다', () => {
  it('공격 번호가 바뀌면 스키마에도 반영된다', () => {
    const { room, id, monster } = roomWithMonster();
    const before = room.state.monsters.get(id)!.attackSeq;

    monster.attackSeq = ((before + 3) % 256) as unknown as number;
    room.syncMonsters();

    expect(room.state.monsters.get(id)!.attackSeq).toBe(monster.attackSeq);
    expect(room.state.monsters.get(id)!.attackSeq).not.toBe(before);
  });

  it('바라보는 방향이 바뀌면 스키마에도 반영된다', () => {
    const { room, id, monster } = roomWithMonster();
    monster.facingX = 1;
    room.syncMonsters();
    expect(room.state.monsters.get(id)!.facingLeft).toBe(false);

    monster.facingX = -1;
    room.syncMonsters();
    expect(room.state.monsters.get(id)!.facingLeft).toBe(true);
  });

  it('공격 모션 상태와 동작 번호도 매 틱 따라온다', () => {
    const { room, id, monster } = roomWithMonster();
    monster.attackAnimTimer = 0.4;
    monster.attackAnim = 2;
    room.syncMonsters();

    expect(room.state.monsters.get(id)!.attacking).toBe(true);
    expect(room.state.monsters.get(id)!.attackAnim).toBe(2);

    monster.attackAnimTimer = 0;
    room.syncMonsters();
    expect(room.state.monsters.get(id)!.attacking).toBe(false);
  });
});
