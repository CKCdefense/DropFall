# 작업 보고서 — client-server 연결 실제 검증 (스모크 테스트)

> `packages/client`가 아직 없어서 "서버가 뜬다"까지만 확인했고, 실제 접속·상태 동기화가
> 되는지는 검증한 적이 없었다. 사용자가 이 점을 지적해서 실제 클라이언트 SDK로 검증했다.

---

## 1. 기획 — 무엇을, 왜

지금까지의 검증(`pnpm dev` 실행 후 "listening on 2567" 로그 확인)은 **서버 프로세스가
죽지 않는다**는 것만 증명했지, 실제로 **클라이언트가 접속해서 룸에 join하고 상태를 주고받을 수
있는지**는 한 번도 확인하지 않았다. Phaser 게임 클라이언트(`packages/client`)는 아직 다른
팀원 몫이라 없지만, Colyseus의 공식 클라이언트 SDK만 있으면 게임 클라이언트 없이도 **실제
프로토콜로** 접속→join→입력 전송→상태 동기화를 끝까지 검증할 수 있다.

목표: 일회성 확인이 아니라 **팀원 누구나 반복 실행할 수 있는 스크립트**로 만들어서
`packages/server`에 남긴다 (`pnpm --filter @dropfall/server run smoke`).

---

## 2. 과정 — 어떻게 했나, 뭘 겪었나

### 2.1 첫 시도: `colyseus.js` — 실패
서버(`colyseus` 0.17.x)에 맞춰 클라이언트도 공식 SDK를 쓰면 된다고 생각해 `colyseus.js`
최신(`0.16.22`)을 설치해서 접속을 시도했다.

```
TypeError: Cannot read properties of undefined (reading 'name')
  at Client.consumeSeatReservation ...
```

**원인**: `colyseus.js` 패키지는 서버 0.16 프로토콜까지만 지원한다. 0.17로 넘어가면서
Colyseus가 클라이언트 SDK 패키지명 자체를 `@colyseus/sdk`로 바꿨다(서버 쪽이 `@colyseus/core`,
`@colyseus/schema` 등으로 전부 스코프 패키지화된 것과 같은 흐름). `npm view colyseus.js
versions`로 확인해보니 0.17대 릴리스가 아예 없다 — 이 패키지 자체가 구버전 라인에 멈춰 있다.

### 2.2 두 번째 시도: `@colyseus/sdk` — join까지는 성공, state 접근에서 실패
`@colyseus/sdk@0.17.43`로 교체하니 접속과 룸 join까지는 성공했다:
```
[smoke-test] joined room "weCLSF9h4" as "N32rMh818"
```
그런데 join 직후 바로 `room.state.players.get(...)`을 읽으니 `players`가 `undefined`였다.
**원인**: join 응답이 오는 시점과 초기 상태(state) 전체가 동기화되는 시점이 다르다 —
join이 끝났다고 상태가 이미 도착해 있는 게 아니라, 첫 상태 패치가 별도 메시지로 뒤이어 온다.
타이밍에 의존해서 `setTimeout` 후 읽는 방식 대신, 공식 문서가 권장하는 반응형 콜백
(`Callbacks.get(room).onAdd('players', ...)`)으로 바꿔서 "내 플레이어 엔티티가 실제로
도착한 시점"을 기다리도록 고쳤다.

### 2.3 최종 스크립트
[packages/server/src/dev/smoke-test.ts](../../packages/server/src/dev/smoke-test.ts)
- `@colyseus/sdk`의 `Client`로 접속 → `joinOrCreate<GameRoom>('game')`
- `Callbacks.get(room).onAdd('players', ...)`로 내 플레이어 상태가 도착하길 기다림
- `room.send('input', {...})`로 이동 입력 전송
- 500ms 후 같은 플레이어 객체(Schema는 in-place로 갱신됨)의 `x`가 실제로 늘었는지 확인
- 실행: `pnpm --filter @dropfall/server run smoke` (서버가 먼저 떠 있어야 함)

---

## 3. 결과 — 검증

```
$ pnpm --filter @dropfall/server run smoke
[smoke-test] connecting to http://localhost:2567 ...
[smoke-test] joined room "weCLSF9h4" as "N32rMh818"
[smoke-test] initial state: x=0 y=0
[smoke-test] after input+500ms: x=40 y=0 seq=1
[smoke-test] OK — 연결, join, 입력 전송, 상태 동기화 전부 확인됨
```

- WebSocket 접속, 룸 매치메이킹(join), Schema 초기 상태 수신, 입력 메시지 처리,
  서버 권위 이동 계산, 변경분 브로드캐스트까지 **실제 프로토콜로 end-to-end 확인됨**
- `x=40`은 `PLAYER_SPEED(100) × moveX(1) × 경과시간(~0.4s)`로 기대값과 일치
- `seq=1`이 그대로 돌아와 [07번 문서](07-work-report-input-sync-hardening.md)에서 추가한
  `lastProcessedSeq` 반영도 같이 확인됨
- 부가로 `pnpm lint` / `pnpm --filter @dropfall/shared test` / `pnpm build` 재확인 — 전부 통과

## 4. 다음 작업

- 이 스모크 테스트를 CI에 넣을지는 아직 결정 안 함 (서버를 띄운 채로 돌려야 해서 별도 셋업 필요 —
  client 스캐폴딩 이후 논의)
- `@colyseus/sdk`가 devDependency로 들어갔으니, 나중에 실제 client 패키지가 같은 SDK를 쓸 때
  버전 충돌 없는지 확인 필요
