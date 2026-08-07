# 작업 보고서 — 자원채집·건축 클라이언트 연결(에셋 없이 플레이스홀더)

> [backend/24](24-work-report-resource-building-mvp.md)에서 서버/공유 시뮬레이션만
> 구현하고 "클라이언트는 역할 C 몫"으로 남겨뒀는데, 실제로 눈으로 보고 테스트해보기
> 위해 도형 플레이스홀더로 클라이언트까지 연결했다. 에셋(스프라이트)은 없다 —
> 색깔 있는 도형으로 자원 노드/건축물을 표시하고, 실제 조작(채집/건축)이 되는지
> 확인하는 게 목적이다.

---

## 1. 기획 — 무엇을, 왜

backend/24 시점엔 서버 계약(프로토콜 메시지, 스키마 동기화)만 완성돼 있고 실제로
플레이해볼 방법이 없었다. "구조물이 진짜 동작하는지" 확인하려면 최소한:
자원 노드가 화면에 보이고, E로 채집하면 인벤토리가 늘고, B로 건축모드에 들어가서
좌클릭하면 건축물이 실제로 서고, 몬스터가 그걸 공격해서 부수는 것까지 눈으로
봐야 한다. 그래서 이번엔 에셋 없이(도형 플레이스홀더) 클라이언트 전 구간
(렌더링/입력/HUD)을 연결했다.

## 2. 과정 — 어떻게 했나

### 2.1 셀 좌표 변환을 공유 유틸로 추출 — `packages/shared/src/constants.ts`

건축 배치는 클라이언트가 "어느 셀을 가리키는지" 계산해서 서버로 보내는 구조라
(§backend/24), 클라이언트가 서버(`World`)와 **정확히 같은** 좌표 변환식을 써야 한다.
기존엔 `world.ts`가 `MAP_SIZE_TILES`/그리드 원점을 자기 파일 안에서만 계산했는데,
그대로면 클라이언트가 같은 공식을 따로(잘못) 재구현할 위험이 있었다. `TILE_SIZE`
옆에 `MAP_SIZE_TILES`, `MAP_ORIGIN`, `worldToCell()`, `cellCenterWorld()`를
공용으로 옮기고, `world.ts`도 자기가 쓰던 사본을 지우고 이 함수들을 가져다 쓰도록
바꿨다 — 정의가 한 곳으로 줄어서 클라이언트/서버가 어긋날 여지가 없어졌다.

### 2.2 네트워크 계층 — `GameConnection`/`LocalConnection`/`ColyseusConnection`

`WorldSnapshot`에 `resourceNodes`/`buildings` 배열과 `PlayerView`에 `wood`/`stone`을
추가하고, `harvest()`(페이로드 없음, `fire()`와 같은 상태 없는 단발 액션)와
`placeBuilding(buildingType, cx, cy)`를 `GameConnection` 인터페이스에 추가했다.
`LocalConnection`은 `World`의 대응 메서드로 바로 위임하고, `ColyseusConnection`은
`room.send('harvest', {})`/`room.send('placeBuilding', {...})`로 서버 메시지를 보내며,
`RemoteGameState`에 `resourceNodes`/`buildings` 맵 타입을 추가해 스냅샷 변환
(`readRawSnapshot`)에 반영했다. `SnapshotInterpolator`는 자원 노드/건축물이 위치가
고정이라 보간·외삽 없이 최신 배열을 그대로 통과시킨다(움직이지 않는 걸 굳이 lerp할
이유가 없다).

### 2.3 렌더링 — `EntityRenderer.ts`

`MONSTER_STYLE`과 같은 패턴으로 `RESOURCE_STYLE`(나무=녹색 원, 돌=회색 원)과
`BUILDING_STYLE`(울타리=옅은 갈색, 벽=짙은 회색, 벽이 더 큼)을 추가했다. 건축물은
몬스터와 똑같은 HP 바 규칙(멀쩡하면 숨김, 맞으면 표시)을 쓴다. 자원 노드는 고갈되면
반투명 처리해서 "지금은 못 캔다"를 색이 아니라 알파로 표시했다.

### 2.4 입력 — `InputController.ts`

- **채집(E)**: `fire()`의 홀드 연사 패턴을 그대로 재사용 — 매 100ms마다
  `connection.harvest()`를 반복 호출하고, 실제 채집 여부/속도는 서버가 판정한다.
- **건축모드(B)**: `off → fence → wall → off` 순환. 별도 "나가기" 키 없이 B를 계속
  누르면 결국 꺼진 상태로 돌아온다.
- **배치(좌클릭)/취소(우클릭)**: backend/18 §1에 이미 정해진 조작 그대로. 좌클릭은
  건축모드 중엔 설치로, 아닐 때는 기존처럼 사격으로 쓴다(같은 버튼을 모드에 따라
  나눠 씀). 우클릭은 브라우저 기본 컨텍스트 메뉴부터 꺼야 받을 수 있어서
  `scene.input.mouse.disableContextMenu()`를 추가했다.
- 커서 아래 셀 계산은 `scene.cameras.main.getWorldPoint()` + 공유
  `worldToCell()`(§2.1)로 한다 — 서버와 같은 공식이라 어긋날 일이 없다.

### 2.5 HUD — `HudScene.ts`

나무/돌 보유량과 현재 건축모드("건축모드: 꺼짐/울타리/벽")를 표시한다. 건축모드는
`InputController`가 `GameScene` 소속이라 registry(`INPUT_CONTROLLER_KEY`)로 꺼내오는데,
`HudScene.update()`가 **매 프레임** 다시 읽기 때문에 씬 시작 순서(HudScene이
InputController 생성보다 먼저 뜰 수 있음)와 무관하게 늦어도 다음 프레임엔 정상값이
채워진다 — init() 시점 1회 읽기였다면 순서에 따라 undefined로 굳어질 수 있었다.

### 2.6 겪은 문제 — Playwright 테스트 중 "이동이 갑자기 안 됨"을 코드 버그로 오인할 뻔함

로컬 모드(`?local=1`)에서 Playwright로 테스트하다가, 특정 시점부터 WASD 이동이 전혀
반영되지 않는 현상을 만났다(`x`/`y`가 여러 틱 동안 완전히 고정). 처음엔 새로 만든
`tickResourceNodes`/`tickMonsters` 확장이나 defeat 상태 처리에 숨은 예외가 있어서
시뮬레이션이 멈췄다고 의심했는데, 콘솔에 에러가 전혀 없었고 `InputController.buildInput()`에
임시로 키 상태를 찍어보니 `left`/`right`/`up`/`down` 전부 `false`로 나왔다 — 즉
**Phaser가 키 이벤트 자체를 못 받고 있었다.** `window`에 직접 단 `keydown` 리스너는
정상적으로 이벤트를 받는 걸 확인했는데도 Phaser의 키 상태(`key.isDown`)만 반영이
안 됐다. `page.bringToFront()`(Playwright가 관리하는 브라우저 창을 실제로 포그라운드로
가져오는 호출)를 키 입력 전에 넣자 즉시 정상 동작했다 — 이 세션 앞부분에서 진단이
난 것과 같은 종류(자동화 브라우저 창의 실제 포커스 여부)의 테스트 환경 문제였지,
게임 코드 버그가 아니었다. 이후 모든 Playwright 키 입력 앞에 `bringToFront()`를
넣어서 정확한(스냅에 찍힌 그대로) 채집/건축 수치 변화를 확인했다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test     # 122 passed (백엔드 변경 없음, 회귀 없음 확인)
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

Playwright로 로컬 모드에서 실제 조작 확인(브라우저 포커스 확보 후):

- 자원 노드가 화면에 도형(초록=나무, 회색=돌)으로 표시됨
- E 홀드 → 나무 노드 채집 시 정확히 1초 간격으로 +5 나무(harvestInterval 준수 확인)
- B 1회 → "건축모드: 울타리"로 정확히 한 단계 전환
- 좌클릭 설치 → 나무 5 → 0(정확히 fence 비용만큼 차감), 클릭한 셀에 정확히
  그리드 스냅된 갈색 사각형(울타리) 렌더링 확인
- 같은 위치에 자원 부족 상태로 재시도 → 조용히 무시(건축물 안 생김, 자원도 그대로)
- 우클릭 → "건축모드: 꺼짐"으로 즉시 취소 확인

전부 통과.

## 4. 다음 작업

- 지금은 전부 도형 플레이스홀더다. 실제 에셋(스프라이트)이 오면
  `RESOURCE_STYLE`/`BUILDING_STYLE` 테이블만 스프라이트 키로 바꾸면 된다(몬스터와
  동일한 교체 지점 구조).
- 그리드 스냅 시각 미리보기(마우스가 가리키는 셀을 하이라이트)는 안 넣었다 —
  지금은 클릭하면 바로 설치/실패가 결정되는 구조라 없어도 테스트엔 지장 없었지만,
  실제 플레이 경험엔 아쉬울 수 있다.
- 무기/도구 선택 UI(도끼로 전환 등)는 아직 없다 — 지금 기본 무기(`pistol`)만
  `fire()`에 하드코딩돼 있어서, 도끼로 채집 도구 겸 근접무기를 실제로 바꿔
  쓰려면 별도 무기 선택 UI가 필요하다.
- 건축모드 커서가 가리키는 셀이 배치 가능한지(자원 부족/이미 점유 등) 클릭 전에
  미리 보여주는 피드백은 없다 — 지금은 클릭해봐야 성공/실패를 안다.
