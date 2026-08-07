# 작업 보고서 — 쉬프트 클릭으로 창고 ↔ 인벤토리 빠른 이동

> 창고(코어 창고) ↔ 인벤토리(퀵슬롯) 사이 아이템 이동이 지금까지 드래그
> 앤드롭(`SlotDrag`) 하나뿐이었다. 쉬프트+클릭으로 목적지 칸을 직접 고르지
> 않고 반대편 컨테이너에 바로 넣는 빠른 이동을 추가했다. 방향은 대칭 —
> 창고 칸을 쉬프트클릭하면 인벤토리로, 퀵슬롯 칸을 쉬프트클릭하면 창고로.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "쉬프트 클릭으로 창고 -> 인벤토리바로이동, 반대의 경우도
가능한 기능 구현해줘".

## 2. 과정 — 어떻게 했나

### 2.1 목적지 칸 자동 선택 — `Inventory.add()` 재사용

`Inventory.add(itemId, count)`(`inventory.ts`)가 이미 "같은 아이템이 있는
칸에 먼저 쌓고, 남으면 빈 칸을 새로 연다"는 규칙으로 목적지 칸을 스스로
고른다 — 몬스터 처치 후 바닥 드롭을 주울 때(`pickUpNearestDrop`)도 같은
메서드를 쓴다. 쉬프트클릭은 "어디에 놓을지"를 사람이 정하지 않는 조작이라
정확히 이 메서드가 필요한 상황이었다. `CoreStorage`도 내부적으로 같은
`Inventory`를 감싸고 있어(`storage.ts`) 인벤토리·창고 양쪽에 그대로
재사용된다.

신규 `World.quickMoveItem(playerId, container, index)` — `container`가
이동을 시작하는 쪽이고 목적지는 항상 반대편이다(`storage`↔`inventory`
컨테이너가 둘뿐이라 명시적인 "to"가 필요 없다). `moveItem`과 같은
`isNearCore` 검사(창고가 얽히므로 항상 적용)를 그대로 따르고, 목적지가
꽉 차서 일부만 옮겨지면 옮겨진 만큼만 원래 칸에서 빼며(`removeAt`), 하나도
못 옮기면 원래 칸을 그대로 둔다 — `moveItem`의 "다 못 들어가면 되돌린다"
원칙과 같은 결과다.

### 2.2 경로 배선 — 방금 만든 철거 기능(docs/backend/43)과 같은 패턴

프로토콜 메시지(`QuickMoveItemMessage`) → `World.quickMoveItem` →
`GameRoom`의 `quickMoveItem` 핸들러 → `GameConnection`/`LocalConnection`/
`ColyseusConnection` 3종 — 방금 구현한 철거 기능이 그대로 전례가 돼서
같은 순서로 채워 넣었다.

### 2.3 쉬프트+클릭 감지 — `SlotDrag`에 얹기

새 등록 체계를 만들지 않고 기존 `SlotDrag`(창고 칸/퀵슬롯 칸을 이미 같은
드래그 공간으로 등록해 둔 컨트롤러)의 `pointerdown` 핸들러에서 분기했다 —
Phaser GameObject의 `pointerdown` 콜백이 받는 `pointer.event`(네이티브 DOM
이벤트)의 `shiftKey`를 보고, true면 드래그(`beginDrag`) 대신 새
`quickMove(cell)`을 부른다. 유령 스프라이트도 안 띄우고 그 자리에서 바로
요청만 보낸다 — 클릭 한 번으로 끝나는 동작이라 드래그 상태 전체가 필요
없다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 18 files, 292 tests 전부 통과(신규 7개)
pnpm --filter @dropfall/server typecheck   # 순차 실행(동시 -r 실행 시 이 환경 OOM)
pnpm --filter @dropfall/client typecheck
pnpm lint      # 에러 0
pnpm build     # client(vite)/server(tsup) 전체 통과
```

신규 테스트 7개(`world-building.test.ts`): 창고→인벤토리 이동, 인벤토리→창고
이동(스택 병합 포함), 목적지가 꽉 차서 일부만 옮겨지는 경우(나머지는 원래
칸에 남음), 완전히 꽉 차서 하나도 못 옮기는 경우, 코어 반경 밖에서 무시되는
경우, 빈 칸을 대상으로 해도 아무 일 없는 경우, 비정상 입력(존재하지 않는
플레이어/컨테이너/인덱스)에도 크래시 없이 무시되는 경우.

## 4. 다음 작업

- **어느 칸이 옮겨졌는지 시각 피드백이 없다** — 드래그는 유령/강조 표시가
  있지만 쉬프트클릭은 즉시 스냅샷 갱신으로만 반영된다. 필요해지면 짧은
  깜빡임 등 연출을 추가할 수 있다.
