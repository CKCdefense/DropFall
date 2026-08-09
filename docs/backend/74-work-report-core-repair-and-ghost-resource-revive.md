# 74. 작업 보고서 — 코어 수리 메뉴화 + 유령 부활 자원 UI 추가

## 기획

사용자 요청(원문):

> 코어 수리는 상점 운으로 나오면 안되고 코어 메뉴에서 수리를 할 수 있게
> 바꿔야할거같은데? 추가로 유령모드 부활도 자원을 사용해서 부활할 수 있게
> 추가해줘

바로 앞 대화에서 현재 구현 상태를 먼저 조사했다:

- **코어 수리**: `repair_kit`(200hp/90에너지)·`core_cell`(500hp/220에너지)
  소모품이 상점 로테이션에 뜨는 날에만 살 수 있었다 — 그날 진열이 안 뜨면
  코어가 깎여도 고칠 방법이 아예 없었다. "운"에 기대는 구조 자체가 문제.
- **유령 부활**: `World.reviveGhostAtCore()`는 이미 서버·시뮬레이션 레벨에
  완성돼 있었다(낮에만, 코어 옆에서, 에너지를 치르고). 그런데 이걸 부르는
  **클라이언트 UI가 어디에도 없었다** — `ReviveBanner`는 유령 본인에게
  "낮에 코어에서 부활할 수 있다"는 안내 문구만 띄울 뿐 상호작용 요소가
  없고, 살아있는 동료가 유령을 선택해서 되살릴 버튼은 존재하지 않았다.
  기능은 있는데 쓸 방법이 없는 상태.

두 가지를 정했다:

1. 코어 수리를 상점 소모품에서 **코어 메뉴의 직접 버튼**(`World.repairCore`)
   으로 옮긴다. 강화와 달리 **낼 수 있는 만큼만** 채운다(부분 수리) —
   깎인 체력은 매번 다른 양이라 "전액이 아니면 아예 안 된다"로 하면 애매한
   자원이 계속 묶인다.
2. 유령 부활의 통화를 **에너지 → 자원**으로 바꾼다. 자원은 코어 강화·건축·
   채집이 전부 걸고 도는 통화라, 부활 한 번이 곧 다른 곳에 쓸 자원을 미루는
   선택이 된다 — 마침 유령 UI를 처음 만드는 김에 코어 수리와 같은 통화로
   통일했다(둘 다 "낮에, 코어 앞에서, 자원을 써서 되돌린다"는 같은 결의
   행동이라 통화가 갈릴 이유가 없다).

## 과정

### 1. 데이터 레이어

- `items.json`: `repair_kit`/`core_cell` 소모품 항목을 통째로 삭제.
  `coreHealAmount` 필드 자체는 스키마에 남겨 뒀다(다른 소모품이 나중에
  다시 쓸 수 있게).
- `coreUpgrades.json`: `repairResourcePerHp: 0.45` 추가 — 옛 두 소모품이
  쓰던 힐량/비용 비율(200/90≈0.45, 500/220≈0.44)을 그대로 물려받되
  통화만 자원으로 바꿨다.
- `revive.json`: `coreReviveEnergy: 60` → `coreReviveResource: 100`으로
  이름·값·통화를 모두 변경. 값을 올린 이유는 자원이 에너지보다 훨씬 자주
  들어오는 통화라, 옛 60을 그대로 옮기면 사실상 공짜 부활이 되기 때문.
- `data/index.ts`: 두 zod 스키마(`CoreUpgradesDataSchema`,
  `ReviveDataSchema`)를 데이터 변경에 맞게 갱신.

### 2. 시뮬레이션 — `World`

- **신설** `repairCore(playerId)`: 근접 판정(`isNearCore`) → 부족한
  체력(`missing`) 계산 → `core.resource`로 낼 수 있는 만큼만
  (`Math.floor(resource / repairResourcePerHp)`) 채우고, 실제 쓴 만큼만
  올림(`Math.ceil`) 차감. 강화(`upgradeCore`)와 나란한 자리에 뒀다.
- **변경** `reviveGhostAtCore(playerId, targetId)`: `core.energy` /
  `reviveData.coreReviveEnergy` 검사·차감을 `core.resource` /
  `reviveData.coreReviveResource`로 교체. 로직(낮에만, 근접, 대상이
  실제로 유령 상태)은 그대로 — 통화만 바뀌었다.

### 3. 프로토콜 · 서버 · 커넥션

- `GameRoom.ts`: `upgradeCore` 핸들러 옆에 `repairCore` 핸들러 추가
  (같은 패턴 — phase 체크 후 `World.repairCore` 호출). `reviveGhost`는
  이미 있던 메시지를 그대로 쓴다(파라미터·경로 변경 없음, `World` 안의
  통화 판정만 바뀌었으므로).
- `GameConnection`/`LocalConnection`/`ColyseusConnection`: `repairCore()`
  메서드를 `upgradeCore()` 옆에 추가.

### 4. 클라이언트 UI — `CorePanel`

기존 "코어 강화" 버튼 하나가 탭 폭을 다 차지하고 있었다. 강화·수리 둘 다
"코어에 자원을 쓰는 결정"이라는 같은 층위라, **세로로 쌓지 않고 절반씩
나란히** 배치했다 — 세로로 쌓으면 그만큼 아래(충전·유령 부활·AI 대사)의
남은 높이가 줄어 창이 점점 빡빡해진다. 수리 버튼은 강화와 같은
`setStatus()` 호출 안에서 상태를 갱신하되, **막히는 조건이 강화와
다르다**: 이미 꽉 찼거나 자원이 아예 0일 때만 비활성화하고, 그 외에는
(설령 완전 수리엔 모자라도) 항상 눌러진다 — 부분 수리이므로.

유령 부활은 충전 칸 아래·AI 대사 위에 **가로 3칸**(최대 인원 4명 - 나 =
팀원 최대 3명)으로 넣었다. 별도 테두리 구역 없이 제목 한 줄 + 버튼 한
줄로 최대한 가볍게 — 강화·충전만큼 자주 쓰는 기능이 아니라서다. 빈 칸은
"-"로 흐리게, 자원이 모자라면 이름은 보이되 비활성화·흐리게 처리해서
"부족하다"는 상태 자체가 항상 보이게 했다(강화 버튼의 색 규칙과 동일한
관례).

레이아웃 예산을 실측했다: 탭 콘텐츠 높이(`contentHeight`)는 524px 고정이고
마스킹(클리핑)이 없어서, 초과하면 프레임 밖으로 그대로 흘러넘친다.
강화+수리를 세로로 안 쌓은 덕에 순수 추가분은 유령 행 하나(제목 18px +
버튼 36px = 54px)뿐이라 AI 대사 칸에 여전히 ~90px가 남는다 — 이전(~114px)
대비 소폭 줄었을 뿐, 클리핑 없이 안전한 범위.

신규 동적 텍스트(수리 버튼 라벨, 유령 칸 이름)는 전부 73번 보고서에서
발견한 Phaser `Text.setText()` 렌더링 고착 버그를 피하려고
`forceSetText()`(`theme.ts`)로 갱신한다 — 이 탭이 그 버그가 실제로
재현됐던 자리(충전 칸)와 같은 "매 프레임 `setText()`로 채우는 칸 여러 개"
패턴이라 처음부터 안전한 헬퍼를 썼다.

- `CorePanel.ts`: `onRepair`/`onReviveGhost` 콜백, `setGhosts()` 메서드,
  수리 버튼·유령 3칸 UI 신설.
- `CoreModal.ts`: 위 셋을 탭 바깥(HudScene)에 위임하는 얇은 통로 추가.
- `HudScene.ts`: `coreModal.onRepair`/`onReviveGhost`를
  `connection.repairCore()`/`connection.reviveGhost(targetId)`에 연결.
  매 프레임 `snapshot.players`에서 나 자신을 뺀 `lifeState === 'ghost'`
  목록을 뽑아 `coreModal.setGhosts(...)`에 공급.
- `itemSprite.ts`: 삭제된 `repair_kit`/`core_cell`의 죽은 프레임 매핑
  두 줄 정리.

### 5. 테스트

- `revive.test.ts`: 코어 유령 부활 테스트 5건을 에너지 → 자원 기준으로
  교체(`energy` dev 커맨드 → `resource` dev 커맨드, `core.energy` →
  `core.resource` 단언).
- `coreUpgrade.test.ts`: `World — 코어 수리` describe 블록 신설, 6건 추가
  — 부분 수리 없이 완전 수리, 자원 부족 시 부분 수리, 이미 꽉 찬 경우
  무시, 자원 0인 경우 무시, 코어에서 먼 경우 무시, 존재하지 않는
  플레이어 무시.

## 결과

- `packages/shared/src/data/{items,coreUpgrades,revive}.json`,
  `data/index.ts`: 소모품 제거 + 수리 비율 + 부활 통화 자원화.
- `packages/shared/src/sim/world.ts`: `repairCore()` 신설,
  `reviveGhostAtCore()` 자원 통화로 전환.
- `packages/server/src/rooms/GameRoom.ts`: `repairCore` 메시지 핸들러.
- `packages/client/src/net/{GameConnection,LocalConnection,ColyseusConnection}.ts`:
  `repairCore()` 배선.
- `packages/client/src/game/ui/{CorePanel,CoreModal}.ts`,
  `packages/client/src/game/scenes/HudScene.ts`: 코어 수리 버튼 + 유령
  부활 3칸 UI 신설·배선.
- `packages/client/src/game/render/itemSprite.ts`: 죽은 아이템 프레임
  매핑 정리.
- `packages/shared/tests/{revive,coreUpgrade}.test.ts`: 기존 5건 갱신 +
  신규 6건 추가.
- 재검증: shared 587/587 통과(신규 6건 포함), server typecheck·test(31)
  통과, client typecheck·build 통과, `pnpm lint` 통과.
