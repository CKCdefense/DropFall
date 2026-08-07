# 백엔드 로컬 세팅 기록 (2026-08 초기 스캐폴딩)

> [05-backend-demo-plan.md](05-backend-demo-plan.md)의 D1 작업을 실제로 진행하면서 겪은 결정과
> 트러블슈팅을 기록한다. **다음에 클론하는 팀원이 같은 문제에 또 부딪히지 않게 하는 것**이
> 이 문서의 목적이다. `pnpm install`만 하면 여기 적힌 이슈들은 이미 설정 파일에 반영돼 있어
> 다시 겪지 않는다 — 그래도 "왜 이렇게 돼 있는지" 알아야 할 상황(버전 업그레이드 등)을 위해 남긴다.

---

## 1. 지금까지 만든 것

`packages/shared`, `packages/server`만 세팅했다. `packages/client`는 비어 있고 다른 담당이 세팅한다.

```
dropfall/
├─ pnpm-workspace.yaml
├─ package.json              # 루트 워크스페이스, packageManager 고정
├─ tsconfig.base.json        # strict, ES2022, module ESNext, moduleResolution bundler
├─ eslint.config.js          # flat config, shared/src에 phaser/colyseus/node 내장모듈 import 금지
├─ .prettierrc
└─ packages/
   ├─ shared/                # @dropfall/shared — 순수 TS, 런타임 의존성은 zod뿐
   │  ├─ src/
   │  │  ├─ constants.ts     # TICK_RATE=20, TILE_SIZE=16, GAME_WIDTH/HEIGHT=480/270, MAX_CLIENTS=4
   │  │  ├─ protocol/messages.ts   # PlayerInputMessage 타입
   │  │  ├─ sim/world.ts     # World 클래스 — addPlayer/removePlayer/setInput/tick/getPlayers
   │  │  ├─ data/index.ts    # zod 검증 loadData() 헬퍼
   │  │  └─ index.ts         # 재수출
   │  └─ tests/world.test.ts # Vitest 3개 — 이동/미입력/제거 케이스
   └─ server/                # @dropfall/server — Colyseus
      ├─ src/
      │  ├─ index.ts         # defineServer + WebSocketTransport, listen(2567)
      │  ├─ rooms/GameRoom.ts
      │  └─ schema/GameRoomState.ts
      └─ tsconfig.json       # experimentalDecorators: true, useDefineForClassFields: false
```

**실행 방법**
```bash
corepack enable && corepack prepare pnpm@latest --activate   # pnpm 없으면
pnpm install
pnpm --filter @dropfall/shared test   # Vitest — 통과 확인됨
pnpm lint                             # ESLint — 에러 0 확인됨
pnpm dev                              # tsx watch로 서버 기동, ws://localhost:2567
```

---

## 2. Colyseus 0.17 — 예전 튜토리얼과 다른 점

Colyseus는 최근 0.17로 API가 바뀌었다(공식 문서로 직접 확인). 인터넷에 흔한 0.14/0.15 예제를
그대로 따라 하면 안 된다.

```ts
// packages/server/src/index.ts — 서버 부트스트랩
import { defineRoom, defineServer } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { game: defineRoom(GameRoom) },
});
server.listen(2567);
```

- 구버전의 `new Server()` / `@colyseus/tools`의 `initializeGameServer` 콜백 방식이 **아니다**
- `Room` 클래스는 `state = new MyState()`를 **클래스 필드로 직접 할당**한다 (`onCreate`에서
  `this.setState()` 호출하는 방식이 아님)
- 메시지 핸들러도 `messages = { input: (client, payload) => {...} }` 클래스 필드로 정의
  ([GameRoom.ts](../../packages/server/src/rooms/GameRoom.ts) 참고)
- 틱 루프: `this.setSimulationInterval(callback, delayMs)` — 이건 예전과 동일
- Schema는 `@colyseus/schema`에서 `Schema`, `type`, `MapSchema` import, `@type()` 데코레이터 사용
- tsconfig에 **`experimentalDecorators: true` 필수** (없으면 `@type()` 데코레이터가 조용히 무시되고
  상태 동기화가 안 됨 — 에러 없이 그냥 안 됨)

---

## 3. pnpm 트러블슈팅 (여기가 제일 중요)

pnpm 11부터 공급망 보안 정책이 기본으로 강화됐다. `colyseus` 설치 중 세 가지 벽에 부딪혔고,
전부 `pnpm-workspace.yaml`에 반영해뒀다.

### 3.1 `blockExoticSubdeps` — GitHub 기반 네이티브 의존성 차단
`colyseus` 패키지는 **필수 peer**로 `@colyseus/uwebsockets-transport`를 요구하는데, 이게
GitHub 저장소(`uNetworking/uWebSockets.js`)에서 네이티브 바이너리를 받아오는 구조라 pnpm이
"신뢰할 수 없는 전이 의존성"으로 차단한다 (`ERR_PNPM_EXOTIC_SUBDEP`).

**판단**: 4인 룸 규모의 예선 데모에 uWebSockets의 성능 이점이 굳이 필요 없고, Windows 개발
환경에서 네이티브 빌드 트러블까지 감수할 이유가 없다. → 순수 JS 구현체인
`@colyseus/ws-transport`를 명시적으로 쓰기로 하고, 안 쓰는 peer는 아예 설치 시도를 끈다.

```yaml
# pnpm-workspace.yaml
autoInstallPeers: false   # peer를 자동으로 설치하지 않음 (필요한 건 직접 add)

peerDependencyRules:
  ignoreMissing:
    - '@colyseus/uwebsockets-transport'   # 경고도 숨김
```

> `peerDependencyRules.ignoreMissing`만으로는 안 된다 — 이건 **경고만 숨기고 설치는 계속 시도**한다.
> 실제로 설치 자체를 막으려면 `autoInstallPeers: false`가 필요하다. 대신 필요한 peer(`@colyseus/schema`,
> `@colyseus/ws-transport`)는 각 패키지에 **직접** `dependencies`로 추가했다.

### 3.2 `ERR_PNPM_IGNORED_BUILDS` — 네이티브 빌드 스크립트 승인제
pnpm 11은 postinstall에서 빌드(컴파일) 스크립트를 실행하는 패키지를 기본 차단하고 명시적 승인을
요구한다. `msgpackr-extract`(Colyseus의 msgpack 직렬화 가속용 네이티브 애드온)와 `esbuild`
(tsx/vitest가 쓰는 번들러)에서 걸렸다. 둘 다 잘 알려진 정상 패키지라 승인 처리:

```yaml
# pnpm-workspace.yaml
allowBuilds:
  esbuild: true
  msgpackr-extract: true
```

새로운 패키지를 추가했는데 `ERR_PNPM_IGNORED_BUILDS`가 뜨면, 그 패키지가 뭘 하는 패키지인지
확인하고 (native addon 컴파일이 흔한 이유) 문제없으면 여기에 같은 방식으로 추가하면 된다.

### 3.3 TypeScript 버전 충돌
`pnpm add -w -D typescript`로 최신을 받으면 `7.0.2`가 설치되는데, `typescript-eslint@8.65.0`은
아직 `>=4.8.4 <6.1.0`만 지원한다 (TS7은 네이티브 컴파일러 전환판이라 아직 린터 생태계가 못 따라감).
`pnpm peers check`로 발견 → `typescript@6.0.3`으로 고정.

**팀 전체 규칙**: `pnpm add -D typescript`처럼 버전 지정 없이 최신을 받지 말 것. 이미 pin된
`^6.0.3`을 그대로 쓴다. 나중에 typescript-eslint가 TS7을 지원하면 그때 올린다.

---

## 4. 다음 단계 (아직 안 한 것)

- `packages/client` 세팅 (다른 팀원)
- CI 워크플로 (client 빌드 세팅 이후)
- 실제 클라이언트 접속 테스트 (지금은 서버 단독 기동만 확인함, 클라가 없어서 join 테스트는 못 함)
- [05-backend-demo-plan.md](05-backend-demo-plan.md)의 D2 이후 항목: 스냅샷 동기화, 클라 예측/재조정, 로비
