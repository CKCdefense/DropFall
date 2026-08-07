# 작업 보고서 — 인게임 모달 UI 셸 4종(코어/코어관리/상점/제작) 선작업

> 백엔드 경제/티어 로직이 나오기 전에, 손으로 그린 와이어프레임(코어 허브 → 코어관리·
> 상점·제작·창고)을 미리 Phaser 모달로 만들어 둔 "선작업"이다. 버튼은 클릭되고 콜백을
> 호출하지만 실제 데이터는 없다 — 다른 작업자가 이후 HudScene/GameScene에 배선한다.

---

## 1. 기획 — 무엇을, 왜

게임에 아직 인게임 모달 시스템 자체가 없었다(HUD는 전부 순수 Phaser GameObject,
로비만 별도 DOM 모달을 씀). 코어 관리/상점/제작 UI가 완성되길 기다리며 배선 작업을
멈추면 나중에 한꺼번에 밀린다. 그래서 실제 경제/티어 로직과 무관하게 **모달의 뼈대
(배경 차단막 + 패널 + 열기/닫기 + 행/버튼 배치)만 먼저 확정**해 두고, 콜백은 전부
no-op 기본값으로 열어 두는 방식을 택했다 — 다른 작업자가 나중에 각 on* 프로퍼티만
채우면 실제 기능이 붙는 구조다.

와이어프레임은 이미지 파일 없이 텍스트 스펙으로만 받았고, 제작(Craft) 화면은
원본에서 잘려 있어 상점과 같은 "칸 그리드 + 하단 상세" 구조를 그대로 따르기로
판단해서 만들었다.

## 2. 과정 — 어떻게 했나

### 2.1 기존 컨벤션 확인

`HudScene.ts`(읽기 전용 참고, 수정 금지 — 다른 작업자가 동시 편집 중)와
`packages/client/src/game/ui/{Minimap,PartyPanel,QuickSlotBar,WaveDial}.ts`를 먼저
읽고 패턴을 맞췄다: `scene.add.rectangle(...).setOrigin(0,0).setStrokeStyle(1, PANEL_STROKE)`
꼴의 테두리 상자, `private readonly` 필드, 한글 주석은 "왜"만 짧게, 픽셀 폰트는
11(Galmuri11)/7(Galmuri7)의 정수배만 사용.

### 2.2 `Modal.ts` — 공용 뼈대

- 전체화면 반투명 차단막(`0x08090c`, alpha 0.6, `setInteractive()`) + 가운데 정렬
  패널(`PANEL_FILL` alpha 0.95 + `PANEL_STROKE` 테두리) + 제목 텍스트 + 우상단 `X` 닫기.
- **패널 밖 클릭만 닫히게 하는 문제**: Phaser 입력은 겹친 인터랙티브 오브젝트 전부에
  이벤트를 쏘기 때문에(depth 순), 패널을 또 `setInteractive()`로 잡고
  `stopPropagation()`에 기대는 대신 — 차단막의 `pointerdown` 핸들러 안에서
  클릭 좌표가 패널 사각형 안인지 직접 계산해서 안이면 무시하는 방식을 택했다.
  더 단순하고, 버튼 클릭이 우연히 차단막까지 히트해도 안전하다(패널 안 좌표면 항상
  무시).
- `open()`/`close()`/`isOpen()`, 시작 시 `setVisible(false)`. 깊이는 차단막 20000,
  패널/제목/닫기/콘텐츠 20001 — HUD의 다른 요소는 depth를 안 쓰므로 항상 최상단.
- 재사용 헬퍼 3개(전부 `protected`, 상속한 4개 모달이 사용):
  - `addRow(y, label, value)` — 좌측 라벨(DIM_TEXT) + 우측 값(BODY_TEXT) 한 줄.
  - `addButton(x, y, w, h, label, onClick)` — 테두리 버튼, 호버 시 테두리를
    강조색으로, 클릭 시 콜백 호출.
  - `addSlot(x, y, size, label, onClick)` — 상점/제작 칸용. 라벨을 칸 하단에 작게 붙임.
    반환한 `Rectangle`에 나중에 `setStrokeStyle`을 다시 걸면 선택 강조로 쓸 수 있다.

  콜백은 클릭 시점에 `() => this.onXxx()`로 인스턴스 프로퍼티를 다시 읽으므로,
  버튼을 만든 **이후에** `modal.onManage = () => {...}`처럼 나중에 배선해도 정상 동작한다.

- **자잘한 타입 함정**: `theme.ts`의 `ACCENT`는 텍스트 색용 문자열(`'#6fd08c'`)인데
  `setStrokeStyle`은 숫자 색만 받는다. `QuickSlotBar.ts`가 이미 같은 이유로 로컬
  숫자 상수(`SELECTED_STROKE = 0x6fd08c`)를 따로 두고 있어서 동일한 패턴을 따랐다
  (`Modal.ts`의 `ACCENT_STROKE`, `StoreModal.ts`/`CraftModal.ts`의 `SELECTED_STROKE`).

### 2.3 `CoreModal.ts` — 허브(루트) 모달

가격/자원/에너지 정보 3행 → "주입" 버튼(전체 폭) → 2x2 이동 버튼(코어 관리/상점,
제작/창고). `onManage`/`onStore`/`onCraft`/`onWarehouse` 콜백 프로퍼티, 기본 no-op.

### 2.4 `UpgradeModal.ts` — "코어 관리" 목적지

정보 3행 + "현재 티어" 행(값 `"1"` placeholder) → 버튼 3개(티어 증가/토지 확장/
코어 수리). 3등분보다 2+1이 한글 라벨에 여유가 있어서 그렇게 배치했다.
`onTierUp`/`onExpandLand`/`onRepairCore`.

### 2.5 `StoreModal.ts` — "상점" 목적지

3x2 칸 그리드(전부 동일 placeholder, "가격: -") + 하단 상세 패널(아이콘 상자 +
"이름/상점" 두 줄 + "구매" 버튼). 칸 클릭 시 선택 칸만 테두리 강조, `onSelectSlot(index)`
호출. `onPurchase`.

### 2.6 `CraftModal.ts` — "제작" 목적지

`StoreModal.ts`와 같은 그리드+상세 뼈대를 병렬 구조로 재사용(호출부가 2곳뿐이라
별도 공유 파일로 뽑진 않음). "재료: -" 칸 라벨, 상세는 "이름/설명" 두 줄 + "제작" 버튼.
`onSelectSlot(index)`/`onCraft`.

## 3. 결과 — 검증

새로 만든 5개 파일만 범위로 확인했다(`HudScene.ts`/`GameScene.ts`/`InputController.ts`/
`packages/shared`/`packages/server`는 다른 작업자가 동시 편집 중이라 건드리지도,
전체 typecheck에 포함시키지도 않았다).

```bash
cd packages/client && npx tsc -p tsconfig.json --noEmit
# Modal.ts / CoreModal.ts / UpgradeModal.ts / StoreModal.ts / CraftModal.ts 관련 에러 0
# (남은 에러는 packages/shared/src/sim/world.ts, src/net/LocalConnection.ts — 이번 작업과
#  무관한 기존/타 작업자 진행 중 파일)

npx eslint src/game/ui/Modal.ts src/game/ui/CoreModal.ts src/game/ui/UpgradeModal.ts \
  src/game/ui/StoreModal.ts src/game/ui/CraftModal.ts
# 출력 없음 (경고/에러 0)
```

Phaser 렌더링 자체(실제 화면에 뜨는지)는 확인하지 않았다 — 아직 어떤 씬에도
인스턴스화·배선되지 않은 순수 셸이라 실행 중인 게임 인스턴스가 없으면 볼 방법이 없고,
그 배선은 이 작업의 범위 밖이다.

## 4. 다음 작업

> **후속 통합 완료(docs/backend/31)**: 아래 1~2번은 이후 배선이 끝났다 —
> `HudScene`에 4개 모달을 인스턴스화하고 `F` 키로 `CoreModal`을 열고 닫으며,
> `onManage`/`onStore`/`onCraft`가 각각 `UpgradeModal`/`StoreModal`/`CraftModal`의
> `open()`으로 연결됐다. Playwright로 실제 클릭 흐름까지 확인 완료.

- ~~`HudScene.ts` 또는 `GameScene.ts`에서 4개 모달을 인스턴스화하고...~~ (완료)
- ~~`CoreModal`의 onManage/onStore/onCraft 라우팅...~~ (완료, `onWarehouse`는
  대응 모달이 없어 로그만 남기도록 남겨뒀다)
- "창고" 목적지 모달은 이번 스펙에 없었다(2x2 버튼 중 하나로만 노출) — 필요해지면
  `UpgradeModal.ts`와 유사한 구조로 추가하면 된다.
- 실제 데이터(가격/자원/에너지/티어/아이템)가 준비되면 `addRow`가 반환하는
  `Text` 오브젝트에 `setText()`를 호출해 갱신하면 된다 — 지금은 전부 placeholder
  문자열(`-`/`0`/`1`)만 박혀 있다.
- `F` 키는 아직 코어 근접 판정 없이 어디서든 열린다 — 실제 기능이 붙으면
  `World.CORE_INTERACT_RADIUS`(자원 입고에 쓰는 것과 같은 반경)를 재사용해서
  근접 판정을 추가하는 게 자연스럽다.
