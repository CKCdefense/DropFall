# 클라이언트 구조

> 역할 C(클라/렌더/UI) 작업 문서. 서버 쪽은 [../backend/](../backend/) 참고.

## 1. 큰 그림

```
┌──────────────── 브라우저 ────────────────┐
│                                          │
│  DOM 레이어            Phaser 레이어      │
│  ─────────            ─────────────      │
│  LobbyApp             GameScene          │
│   · 타이틀              · 월드 렌더        │
│   · 방 목록             · 카메라/입력      │
│   · 방 만들기          HudScene           │
│   · 코드 참여           · 화면 고정 UI     │
│        │                    ▲            │
│        └─ GameConnection ───┘            │
│                 │                        │
└─────────────────┼────────────────────────┘
                  │
      ┌───────────┴───────────┐
      ▼                       ▼
ColyseusConnection      LocalConnection
 (서버 권위)             (브라우저 안 sim)
```

`main.ts`가 로비와 게임을 전환한다. 로비에서 입장에 성공하면 `GameConnection`을 하나 만들어
Phaser를 띄우고, 나가면 Phaser를 파괴하고 로비로 돌아온다.

## 2. 핵심 결정

### 2.1 `GameConnection` 추상화 — 서버를 기다리지 않기 위한 장치

렌더링 코드는 데이터가 **서버에서 왔는지 브라우저 안 시뮬레이션에서 왔는지 모른다.**

| 구현 | 용도 |
|---|---|
| `ColyseusConnection` | 실제 서버 연결 |
| `LocalConnection` | `shared/sim`의 `World`를 브라우저에서 직접 20Hz로 돌린다 |

`?local=1` 로 오프라인 모드에 진입한다. 서버 작업이 막혀 있어도 클라이언트 개발이 멈추지 않고,
서버가 준비되면 구현체만 바꿔 끼우면 된다.

> 이게 성립하는 전제는 **`shared/sim`이 Phaser/DOM/Node를 import하지 않는 것**이다
> ([기술 명세 §2.1](../02-tech-spec.md)). ESLint `no-restricted-imports`로 강제되고 있다.
> 이 규칙이 깨지면 오프라인 모드가 먼저 죽는다.

`getSnapshot()`은 매 프레임 호출되므로 **구현체는 내부 버퍼를 재사용**한다(매 프레임 배열 생성 금지).

### 2.2 로비는 DOM, 인게임 HUD는 캔버스

[기술 명세 §7.5](../02-tech-spec.md)는 "DOM UI를 쓰지 않는다"였다. 로비에 한해 예외를 뒀다.

- **로비/타이틀 = DOM**: 텍스트 입력·포커스·**한글 IME 조합**·스크롤 목록을 캔버스에서 다시
  구현하는 비용이, 픽셀아트 일관성으로 얻는 이득보다 훨씬 크다. 픽셀 느낌은 CSS로 낸다
  (`image-rendering: pixelated`, 각진 테두리, 오프셋 그림자).
- **인게임 HUD = 캔버스**: 게임 화면 위에 겹치고, 카메라 줌/스케일과 함께 움직여야 하며,
  이후 9-slice 픽셀 프레임으로 교체될 대상이다. 여기서 DOM을 섞으면 스케일이 어긋난다.

경계는 명확하다. **인게임 화면에 뜨는 것은 전부 캔버스.**

### 2.3 렌더링 해상도 — 월드와 UI를 분리한다

**캔버스는 창 크기(네이티브 해상도), 월드 카메라만 정수배(2x~4x) 줌.**
저해상도 캔버스를 통째로 확대하면 UI 텍스트까지 뭉개진다. 특히 **한글은 8px에서 판독이
불가능**해서(자소 조합 구조) 저해상도 캔버스와 양립하지 않는다.

| 대상 | 해상도 |
|---|---|
| 월드(스프라이트/타일) | 16px 타일을 카메라 줌으로 32~64px로 확대 |
| HUD | 네이티브 해상도, `uiScale = clamp(zoom / 2, 1, 2)` |
| 월드 안의 텍스트(닉네임) | 월드 좌표 + `setResolution(zoom)` |

줌 계산은 `computeCameraZoom()`(shared, 유닛 테스트 있음). 캔버스가 창을 따라가므로
`Phaser.Scale.Events.RESIZE`에서 줌과 HUD 레이아웃을 다시 계산한다.

배경과 검증: [04-work-report-resolution-policy.md](04-work-report-resolution-policy.md)

### 2.4 Scene 구성

| Scene | 역할 |
|---|---|
| `GameScene` | 월드 렌더. 카메라가 플레이어를 따라다닌다 |
| `HudScene` | 화면 고정 UI. `GameScene`이 `launch`로 띄운다 |

두 Scene을 나눈 이유는 카메라다. `GameScene`의 카메라는 이동/줌하지만 HUD는 고정이어야 한다.

연결 객체는 **`game.registry`로 전달**한다(`CONNECTION_KEY`). Scene 시작 순서에 의존하는
`scene.start(key, data)` 방식은 자동 시작되는 첫 Scene에서 데이터가 비는 문제가 있다.

원래 계획의 `Boot`/`Preload` Scene은 **아직 만들지 않았다.** 로드할 에셋이 없어서 빈 껍데기가
되기 때문이다. 아틀라스가 생기면 `PreloadScene`을 추가한다.

### 2.5 렌더 동기화 계층

`EntityRenderer`가 스냅샷을 스프라이트에 반영한다 — 생성/갱신/삭제, `depth = y` 정렬, 정수 스냅.
앞으로 몬스터·투사체·건축물이 전부 여기에 얹힌다.

아트가 없어서 지금은 도형 플레이스홀더(`createPlayer`)를 쓴다. 아틀라스가 준비되면
**이 메서드만** 스프라이트로 교체하면 된다.

### 2.6 입력

`InputController`가 WASD + 마우스 조준을 `PlayerInputMessage`로 만들어 **20Hz로** 보낸다.
전송 주기와 대각선 정규화 이유는 [02-lobby-room-protocol.md](02-lobby-room-protocol.md) 참고.

## 3. 디렉터리

```
packages/client/
├─ index.html            #ui-root(DOM) / #game-root(Phaser)
├─ vite.config.ts        base: './' — Pages 하위경로/홈서버 루트 양쪽 대응
└─ src/
   ├─ main.ts            로비 ↔ 게임 전환, ESC 탈출, 딥링크 진입
   ├─ net/
   │  ├─ config.ts               서버 주소 해석, ?local / 딥링크 파싱
   │  ├─ GameConnection.ts       인터페이스 (렌더가 의존하는 유일한 계약)
   │  ├─ ColyseusConnection.ts   서버 연결 + 방 생성/참여 + 에러 한국어화
   │  ├─ LocalConnection.ts      오프라인 시뮬레이션
   │  └─ lobbyApi.ts             GET /rooms
   ├─ ui/
   │  ├─ LobbyApp.ts     타이틀/목록/생성 화면 라우팅 (DOM)
   │  ├─ dom.ts          el() 헬퍼
   │  └─ styles.css      팔레트는 커스텀 프로퍼티로 분리
   └─ game/
      ├─ createGame.ts   Phaser 설정 (pixelArt/roundPixels/RESIZE)
      ├─ scenes/         GameScene, HudScene
      ├─ render/         EntityRenderer
      └─ input/          InputController
```

## 4. 실행

```bash
pnpm dev            # 클라(5173) + 서버(2567) 동시
pnpm dev:client     # 클라만
pnpm typecheck
pnpm build
```

### URL 파라미터

| 파라미터 | 용도 |
|---|---|
| `?server=<url>` | 서버 주소 오버라이드. 시연 중 재배포 없이 전환 |
| `?local=1` | 서버 없이 오프라인 모드로 바로 진입 |
| `?create=1&nickname=X&roomName=Y[&password=Z]` | 로비 건너뛰고 방 생성 |
| `?room=CODE&nickname=X[&password=Z]` | 로비 건너뛰고 코드로 참여 |

딥링크는 **멀티 테스트용 개발 편의 기능**이다. 탭 두 개를 각각
`?create=1...` / `?room=CODE...` 로 열면 폼을 채우지 않고 2인 접속을 재현할 수 있다.

## 5. 아직 안 한 것

- `PreloadScene`, 아틀라스 파이프라인 (에셋 확정 후)
- 픽셀 폰트 (라이선스 확인 후 비트맵 폰트로. 지금은 monospace)
- 클라이언트 예측/재조정 — 현재는 **서버 상태를 그대로 그린다**(보간 없음).
  움직임이 20Hz 계단으로 보이는 건 알려진 상태다. 보간 → 예측 순으로 붙인다
- 9-slice 픽셀 UI 컴포넌트 (`NineSlicePanel`, `PixelButton`, `ItemSlot` …)
- 코어 HP / 웨이브 표시는 **플레이스홀더**다. sim에 해당 상태가 생기면 연결한다
