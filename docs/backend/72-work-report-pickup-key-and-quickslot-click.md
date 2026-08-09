# 72. 작업 보고서 — 줍기 전용 키(스페이스) 추가 + 퀵슬롯 좌클릭 장착

## 기획

게임 흐름 피드백 7개 중 클라이언트 UI/입력 영역인 1, 3, 4번 중 4번(HUD 개편)은
클라이언트 담당자가 작업 중이라, 사용자가 1번과 3번을 요청했다. 원래는 백엔드
(역할 A) 소관 밖이라고 안내했던 항목이지만, 서버 API가 이미 있어(1번은
`pickUp()`, 3번은 `selectSlot()`) 클라이언트 배선만으로 끝나는 작업이라 이번엔
직접 진행했다.

- **1번**: "E버튼이 WASD와 붙어있어 움직이면서 줍기 어려움 → 스페이스바 같은
  걸로 수집 행동을 바꾸는 게 좋을 것 같음"
- **3번**: "인벤토리 퀵슬롯에 있는 물건 좌클릭으로 현재 들고 있는 무기 변경하는
  기능 → 현재는 드래그앤드롭으로 슬롯 간 아이템 변경밖에 구현되지 않음"

## 과정

### 1. 줍기 전용 키(Space) 추가

`InputController.ts`를 보니 `E`는 이미 다중 역할이었다 — 누르면(`keydown`)
`onInteract()`(코어 근처면 창고 모달, 티모시 근처면 대사, 발밑에 드롭이 있으면
줍기 우선)를 먼저 묻고, 아니면 `pickUp()`으로 떨어진다. 여기에 더해
`interact.isDown`은 **매 틱 입력에 실려** 서버로 가서 쓰러진 동료 옆 구조(5초
홀드)에도 쓰인다 — E 하나가 세 가지 맥락(모달/대사/줍기)과 한 가지 홀드(구조)를
전부 겸하고 있었다.

수집이 어렵다는 지적은 이 중 "이동 중 줍기"에만 해당하고, 코어 모달·구조·티모시
대사는 애초에 제자리에 서서 하는 동작이라 문제가 아니다. 그래서 **E의 기존
동작은 그대로 두고**, Space를 "무조건 줍기만 하는" 전용 키로 추가했다 — 기존
동작을 바꾸면 손에 익은 사람들에게 회귀가 되고, 코어/구조/티모시 로직까지
건드릴 이유가 없었다.

```ts
keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on('down', () => {
  this.connection.pickUp();
});
```

`keyboard.addKey()`는 기본으로 `enableCapture: true`라 브라우저의 스페이스바
스크롤 기본 동작도 자동으로 막힌다(WASD/E/R/X와 같은 방식이라 별도 설정 불필요).

### 2. 퀵슬롯 좌클릭 장착

`SlotDrag.ts`를 보니 퀵슬롯 칸은 이미 `pointerdown`에서 드래그를 **시작**하고
있었다 — 그런데 같은 칸에서 그냥 뗀 경우(`target === source`)는 `onPointerUp`이
아무 것도 안 하고 조용히 취소했다. 즉 "좌클릭만" 하면 사실상 아무 일도 안
일어나는 게 기존 동작이었다(무기 변경은 숫자키 1~4 아니면 드래그로 다른 칸에
떨어뜨리는 것뿐).

`SlotDrag`에 `onClickSelect(container, index)` 콜백을 추가하고, "같은 칸에서
뗀 클릭"을 이 콜백으로 연결했다:

```ts
if (target === source) {
  this.onClickSelect(source.container, source.index);
  return;
}
```

`HudScene.ts`에서 `container === 'inventory'`(퀵슬롯)일 때만
`connection.selectSlot(index)`를 부르도록 배선했다 — 창고 칸 등은 "손에 든다"는
개념이 없어 무시한다. `selectSlot`은 숫자키 1~4가 이미 쓰던 것과 완전히 같은
서버 API라 새 메시지 타입이 필요 없었다.

쉬프트+클릭(빠른 이동, docs/backend/44)은 `pointerdown` 시점에 따로 갈라져서
`beginDrag`(즉 `this.source`)가 아예 안 걸리므로, 이번 변경과 겹치지 않는다.

## 결과

- `packages/client/src/game/input/InputController.ts`: Space 키 추가(줍기 전용).
- `packages/client/src/game/ui/SlotDrag.ts`: `onClickSelect` 콜백 추가, 제자리
  클릭을 드래그 취소 대신 이 콜백으로 연결.
- `packages/client/src/game/scenes/HudScene.ts`: `onClickSelect`를
  `connection.selectSlot`에 배선(인벤토리 칸만).
- 재검증: client typecheck·build 통과(클라이언트는 별도 테스트 스위트가 없어
  `tsc --noEmit` + `vite build`로 확인), shared 전체 566/566 + server
  typecheck·test(31) 재확인(영향 없음, 회귀 없음 확인 목적) + lint 전부 통과.
