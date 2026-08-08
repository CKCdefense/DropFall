# 작업 보고서 — 다운된(hp 0) 플레이어가 이동 말고는 아무 동작도 못 하게 막음

> 플레이어가 다운돼도(hp<=0) 공격·제작·건축·아이템 이동·투표·업그레이드
> 등 대부분의 행동에 hp 체크가 없어서 그대로 동작하고 있었다 —
> `useSelectedItem`(자가 회복 방지)에만 있던 규칙을 나머지 플레이어 행동
> 전체로 확장했다.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "캐릭터 사망판정이 나면 아무 동작도 못하게 막아야해". 이어서
"움직이는건 하게해"로 이동만 예외로 남기도록 조정.

## 2. 과정 — 어떻게 했나

### 2.1 조사 — hp 체크가 있는 곳과 없는 곳

`player.hp <= 0` 체크는 몬스터의 공격 대상 선정, 동료 탐색, 전멸 판정
등 **다른 시스템이 다운된 플레이어를 어떻게 취급하는지**에는 곳곳에 있었지만
(`revealAroundPlayers`, `findNearestPlayer`, `checkAllPlayersDown` 등),
**다운된 플레이어 자신이 뭘 할 수 있는지**를 막는 곳은
`useSelectedItem`(자가 회복 방지, 기존 코드) 딱 하나뿐이었다. `fireWeapon`,
`craftItem`, `placeBuilding`, `demolishBuilding`, `moveItem`,
`quickMoveItem`, `pickUpNearestDrop`, `castSkipVote`, `upgradeCore`,
`sellToShop`, `buyFromShop`, `requestCompanionInteraction` — 전부
그대로 통과됐다.

### 2.2 수정 — 각 메서드의 "플레이어 조회" 직후에 통일

각 메서드가 `this.players.get(playerId)`로 플레이어를 가져오는 바로 그
지점에 `|| player.hp <= 0`을 추가했다 — `useSelectedItem`이 이미 쓰던
것과 같은 스타일(`if (!player || player.hp <= 0) return;`). 일부는
`if (!this.players.has(playerId)) return;` 형태였던 걸 플레이어 자체를
가져오는 형태로 바꿔야 했다.

**이동은 예외로 남겼다.** 처음엔 `tick()`의 이동 루프까지 막았는데
("도망도 못 가면 그냥 방치되는 시체"), 사용자 피드백으로 이동만
빼고 나머지는 그대로 뒀다 — 부활 전까지 최소한의 조작(도망/포지셔닝)은
가능해야 한다는 판단.

**`selectSlot`도 예외다.** 원래 코드 주석에 "선택만 바꾸는 동작이라
페이즈(낮/밤)와 무관하게 허용한다"는 기존 설계 의도가 있어서, 같은 이유로
다운 여부와도 무관하게 뒀다 — 게임 상태에 영향이 없는 순수 UI 선택이다.

**`requestCoreInteraction()`은 이번 범위에서 뺐다.** playerId를 아예
안 받는 방 전역 트리거(코어 음성 대사만 재생, 실질적 이득 없음)라, 막으려면
프로토콜에 playerId를 추가하는 더 큰 변경이 필요하다 — 낮은 우선순위로
남겨둔다.

## 3. 결과 — 검증

`world-combat.test.ts`에 회귀 테스트 7개 추가 — 이동은 되는지(양성),
공격·줍기·제작·건축·투표·업그레이드는 안 되는지(음성) 각각 확인했다.
`craftItem` 테스트는 창고 초기 지급품 때문에 절대량이 아니라 변화량으로
비교했다(economy.test.ts와 같은 이유).

```bash
pnpm --filter @dropfall/shared test        # 437/437
pnpm --filter @dropfall/server typecheck
pnpm --filter @dropfall/server test        # 31/31
pnpm --filter @dropfall/client typecheck
pnpm lint
```

## 4. 다음 작업

- `requestCoreInteraction()`도 막으려면 `companionInteract`처럼
  playerId를 프로토콜에 추가해야 한다 — 실질적 이득이 없는 트리거라
  우선순위는 낮다.
