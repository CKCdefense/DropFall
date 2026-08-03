# 작업 보고서 — 클라이언트 초기 설정 + 로비/HUD

## 기획

1. **서버 프로덕션 빌드 수정** (긴급) — `pnpm build`는 통과하는데 `node dist/index.js`가
   실행되지 않는 상태였다. 홈서버 배포가 이 경로를 전제로 한다.
2. **클라이언트 패키지 신설** — Vite + Phaser 3, 픽셀아트 설정, 게임 진입 화면 라우팅.
3. **방 생성/참여** — 닉네임 + 비밀번호로 방을 만들고, 방 목록 또는 방 코드로 참여.
4. **HUD** — 인게임 화면 고정 UI.

## 과정

### 1. 서버 빌드가 실행되지 않던 문제

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  'C:\...\dist\rooms\GameRoom' imported from ...\dist\index.js
```

원인이 두 개 겹쳐 있었다.

- `moduleResolution: "bundler"` + `tsc` 조합은 **확장자 없는 상대 import를 그대로 출력**한다.
  소스에서는 유효하지만 Node ESM은 `.js` 확장자를 요구한다.
- `@dropfall/shared`가 빌드 산출물 없이 **TS 소스를 직접 export**한다(`main: "./src/index.ts"`).
  `tsx`/Vite는 처리하지만 `node`는 못 읽는다.

`tsc` 대신 **tsup 번들링**으로 바꿔 둘 다 해소했다. `noExternal: ['@dropfall/shared']`로
워크스페이스 패키지를 번들 안에 인라인한다. 산출물이 파일 하나가 되어 홈서버 배포도 단순해진다.
타입 검사는 `typecheck` 스크립트(`tsc --noEmit`)로 분리했다.

### 2. Colyseus 0.17에서 방 목록/코드 참여

인터넷 예제 대부분이 0.14~0.16 기준이라 그대로 쓸 수 없었다.

- **`client.getAvailableRooms()`가 0.17 SDK에 없다.** 서버에서 `matchMaker.query()`로
  `GET /rooms`를 직접 노출했다.
- **`filterBy`로 방 코드를 매칭하려던 계획을 버렸다.** `Room#roomId`를 `onCreate`에서
  교체할 수 있다는 걸 확인하고, **방 코드를 roomId 자체로** 만들었다. 목록 참여와 코드 참여가
  전부 `joinById` 하나로 통일된다. 상세: [02-lobby-room-protocol.md](02-lobby-room-protocol.md)
- 개발 중 클라(:5173)와 서버(:2567)의 오리진이 달라 **CORS 미들웨어**를 추가했다.
  프로덕션 기본값은 `*`가 아니라 빈 값이며 `CLIENT_ORIGIN`으로 지정한다.

### 3. 로비를 DOM으로 만든 판단

기술 명세는 "DOM UI 금지"였지만 로비에 한해 예외를 뒀다. 텍스트 입력·포커스·**한글 IME 조합**·
스크롤 목록을 캔버스에서 다시 구현하는 비용이 너무 크다. **인게임 HUD는 원칙대로 캔버스**다.
근거와 경계는 [01-client-architecture.md §2.2](01-client-architecture.md).

### 4. Phaser 함정 두 가지

- **`Scene`에 `renderer` 라는 이름의 프로퍼티를 쓰면 안 된다.** `Phaser.Scene`에 이미 있어서
  타입이 충돌한다(`entityRenderer`로 변경).
- **`scene: [A, B]` 배열은 첫 Scene만 자동 시작된다.** 자동 시작되는 Scene에는 `start(key, data)`의
  data가 전달되지 않는다. 연결 객체는 `game.registry`로 넘기고, HUD는 `GameScene`이
  `scene.launch()`로 띄우는 구조로 정리했다.

### 5. shared/sim 수정 (합의된 두 건)

- **대각선 정규화** — `clamp`만 하면 `(1,1)`이 통과해 대각선 속도가 √2배가 됐다.
- **`seq` 단조 증가 검증** — 순서가 뒤바뀐 입력을 받아들이면 `lastProcessedSeq`가 되감겨
  클라이언트가 재조정 시 튄다.

기존 clamp 테스트가 정규화 이전 동작(`(999,-999) → (100,-100)`)을 고정하고 있어 함께 갱신했다.

## 결과

### 검증

| 항목 | 결과 |
|---|---|
| `pnpm typecheck` (shared/server/client) | 통과 |
| `pnpm test` | 20 passed (world 11 + room 9) |
| `pnpm lint` | 통과 |
| `pnpm build` | 서버 tsup / 클라 vite 통과 |
| `node dist/index.js` | **정상 기동** (수정 전 실패) |
| `pnpm smoke` | 통과 |
| `pnpm smoke:lobby` | 통과 — 코드 발급, 목록 노출, 비밀번호/닉네임 거절, 참여 |
| 브라우저 로비 렌더 | 확인 (headless Chrome) |
| 브라우저 → 서버 실접속 | **확인** — 코드로 참여, `clients: 2`, HUD에 두 플레이어 닉네임 |

`smoke:lobby`는 방 목록 응답에 **비밀번호 문자열이 섞여 나오지 않는지**도 검사한다.

### 알려진 상태 / 다음 작업

- **보간이 없다.** 서버 상태를 그대로 그려서 원격 플레이어가 20Hz 계단으로 움직인다.
  보간 → 자기 캐릭터 예측 순으로 붙인다. (가장 우선)
- 코어 HP / 웨이브 HUD는 **자리만 잡은 플레이스홀더**다. sim에 상태가 생기면 연결한다.
- 픽셀 폰트 미정 — 현재 monospace. 라이선스 확인 후 비트맵 폰트로 교체.
- 스프라이트 없음 — 도형 플레이스홀더. `EntityRenderer#createPlayer`만 교체하면 된다.
- 방 목록 자동 갱신 없음(수동 새로고침). 필요해지면 폴링을 넣는다.
- `allowReconnection` 미구현.
