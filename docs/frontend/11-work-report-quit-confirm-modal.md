# 작업 보고서 — ESC 나가기에 확인창 추가

> 예전엔 ESC 한 번에 바로 로비로 돌아갔다 — 오발 입력 한 번으로 진행
> 중이던 판을 통째로 잃는 사고를 막기 위해 "정말 나가시겠습니까?" 확인
> 단계를 끼워 넣었다.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "esc 눌렀을 때 바로 종료되는게 아니라 확인모달 거쳐서 나가는
방식 추가해줘".

## 2. 과정 — 어떻게 했나

### 2.1 새 컴포넌트 — `confirmQuit.ts`

`packages/client/src/ui/confirmQuit.ts`(신규): `showQuitConfirm(container,
onConfirm)` 하나만 내보내는 작은 모듈. "나가기"/"취소" 버튼, `Enter`=확인·
`Esc`/바깥 클릭=취소(다른 모달들의 관례를 그대로 따름, `LobbyApp.ts`
참고). 이미 열려 있으면 중복으로 새로 안 연다.

### 2.2 어디에 붙이나 — `#app`, uiRoot/gameRoot 둘 다 아니고

`index.html`은 `#app`(뷰포트 고정 셸) 안에 `#ui-root`(로비, 인게임에서는
`hidden`)와 `#game-root`(Phaser 캔버스, 로비에서는 `hidden`)를 서로
반대로 숨긴다. 확인창은 ESC가 로비/인게임 어느 화면에서 눌려도 떠야 하니,
둘 중 하나가 아니라 부모인 `#app`에 직접 붙인다.

### 2.3 크기 — 기존 `.modal`을 그대로 못 쓴 이유

로비의 방목록/방만들기 모달은 `--modal-w: 760px`, `--modal-ratio: 1.55`
고정 비율을 쓴다(내용이 방 목록 그리드라 큰 상자가 필요). 확인창은 문구
한 줄 + 버튼 두 개뿐이라 그 비율을 그대로 물려받으면 대부분이 빈 공간인
큰 박스가 뜬다 — `.confirm-modal`로 `width: min(360px, 88vw)`,
`aspect-ratio: auto`(내용 높이에 맞춤)를 따로 잡았다.

### 2.4 곁가지 확인 — 채팅창과 안 겹치는지

채팅창(`ChatBox.ts`)이 열려 있을 때 ESC를 누르면 채팅만 닫혀야지, 나가기
확인창이 같이 뜨면 안 된다. 확인해보니 `ChatBox`가 이미 입력창
keydown에서 `event.stopPropagation()`을 걸어 뒀다(Enter로 열 때 같은
keydown이 `window`까지 버블돼 곧바로 다시 닫히는 걸 막으려던 기존 조치) —
그 덕에 채팅 입력창의 키 입력은 애초에 `main.ts`의 전역 ESC 리스너까지
안 올라간다. 추가 수정 없이 확인만 하고 넘어갔다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/client typecheck
pnpm --filter @dropfall/client build
pnpm lint
```

## 4. 다음 작업

- 없음. 필요해지면 다른 파괴적 동작(예: 게임 리셋류)에도 같은
  `confirmQuit.ts` 패턴을 재사용할 수 있다.
