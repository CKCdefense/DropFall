import type { PlayerView } from '../../net/GameConnection';

/**
 * 플레이어별 식별 색.
 *
 * 미니맵 점과 파티 칸의 색 조각이 **같은 색**이어야 "저 점이 저 사람"이 성립한다.
 * 그래서 색을 정하는 규칙을 한 곳에 두고 양쪽이 같은 함수를 부른다 — 두 곳에서 따로
 * 정하면 반드시 어긋난다.
 *
 * 나는 항상 초록이다. 남의 색이 어떻게 배정되든 "내가 어디 있나"는 안 바뀌어야 한다.
 */

/** 나. 미니맵에서 오래 쓰던 색을 그대로 둔다 — 눈이 이미 익었다. */
export const SELF_COLOR = 0x6fd08c;

/**
 * 남에게 돌아가는 색.
 *
 * 미니맵의 다른 표시(몬스터 붉은색, 자원 짙은 초록, 건축물 갈색, 콜로니 보라, 코어
 * 회색)와 겹치지 않는 색만 골랐다. 방 정원이 4명이라 남은 최대 3명 — 넷을 두면 하나가
 * 여유분이다.
 */
const PALETTE = [0x5cc6e8, 0xf0b429, 0xe86ac6, 0xa88cff] as const;

/**
 * 플레이어 id → 색.
 *
 * **id를 정렬해서 순서대로** 나눠 준다. 접속 순서로 주면 클라이언트마다 목록 순서가
 * 달라 같은 사람이 다른 색으로 보이고, id를 해시하면 4명 안에서도 색이 겹칠 수 있다.
 * 정렬은 모두가 같은 결과를 내면서 겹치지도 않는다.
 *
 * **전체 명단**을 넘겨야 한다 — 파티 칸은 나를 뺀 목록을 그리지만, 색은 전체 기준으로
 * 정해져야 미니맵과 맞는다.
 */
export function playerColors(
  players: readonly PlayerView[],
  ownSessionId: string,
): Map<string, number> {
  const colors = new Map<string, number>();
  const others = players
    .map((player) => player.id)
    .filter((id) => id !== ownSessionId)
    .sort();

  colors.set(ownSessionId, SELF_COLOR);
  others.forEach((id, index) => {
    colors.set(id, PALETTE[index % PALETTE.length]!);
  });
  return colors;
}
