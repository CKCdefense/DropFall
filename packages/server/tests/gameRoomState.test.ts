import { describe, expect, it } from 'vitest';
import { ArraySchema } from '@colyseus/schema';
import { replaceArrayContents } from '../src/rooms/GameRoom';

/**
 * 실제로 겪은 버그의 회귀 테스트 — 게임을 시작하자마자 첫 상점 진열을 내려보내는
 * 순간 서버가 매 틱 계속 죽어서 결국 클라이언트 연결이 끊겼다(GameRoom.update()의
 * shopStock 동기화). 원인은 `ArraySchema#splice(0, len, ...새값)`로 통째로 갈아
 * 끼우는 패턴 — Colyseus의 ArraySchema#splice는 insertCount가 deleteCount보다 크면
 * 예외를 던진다. 빈 배열(길이 0) 위에 원소를 채우는 게 정확히 이 경우였다.
 */
describe('replaceArrayContents — ArraySchema 전체 교체', () => {
  it('빈 배열 위에 원소를 채워도(길이가 늘어나도) 예외를 던지지 않는다', () => {
    // 게임 시작 직후 state.shopStock과 정확히 같은 상태(길이 0)에서 시작한다.
    const schema = new ArraySchema<string>();
    expect(() => replaceArrayContents(schema, ['a', 'b', 'c'])).not.toThrow();
    expect([...schema]).toEqual(['a', 'b', 'c']);
  });

  it('원소를 줄여도(길이가 줄어도) 정상 동작한다', () => {
    const schema = new ArraySchema<string>('a', 'b', 'c', 'd');
    expect(() => replaceArrayContents(schema, ['x'])).not.toThrow();
    expect([...schema]).toEqual(['x']);
  });

  it('같은 길이로 교체해도 정상 동작한다', () => {
    const schema = new ArraySchema<string>('a', 'b');
    replaceArrayContents(schema, ['c', 'd']);
    expect([...schema]).toEqual(['c', 'd']);
  });

  it('빈 값으로 교체하면 배열이 비워진다', () => {
    const schema = new ArraySchema<string>('a', 'b');
    replaceArrayContents(schema, []);
    expect([...schema]).toEqual([]);
  });

  it('문서화용: splice(0, len, ...새값)로 되돌리면 늘어나는 경우 예외가 난다', () => {
    // replaceArrayContents 구현을 다시 splice 방식으로 되돌리고 싶어질 때, "왜 안 되는지"를
    // 코드로 보여준다 — ArraySchema 쪽 동작이 바뀌면 이 테스트가 먼저 알려준다.
    const schema = new ArraySchema<string>();
    expect(() => schema.splice(0, schema.length, 'a', 'b', 'c')).toThrow(
      /insertCount must be equal or lower than deleteCount/,
    );
  });
});
