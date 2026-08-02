# 팀 공유 노트 — 작업 시작 전에 알아야 할 것

> `packages/shared`, `packages/server` 기반이 세팅됐다. `packages/client`는 아직 없다 —
> 누구든 client를 시작하면 이 문서부터 읽고 시작하면 된다. 서버 쪽 상세 결정/트러블슈팅은
> [backend/](backend/)에 작업 단위로 기록돼 있으니, 여기서는 **지금 당장 알아야 할 것만** 요약한다.

---

## 1. 로컬에서 돌려보기

```bash
# pnpm이 없으면 먼저
corepack enable && corepack prepare pnpm@latest --activate

pnpm install
pnpm dev     # 지금은 서버만 뜬다 (client 패키지 생기면 이 스크립트 갱신 필요)
pnpm test    # packages/shared 유닛 테스트
pnpm lint
pnpm build
```

**게임 클라이언트 없이 서버 동작을 눈으로 확인하고 싶으면**: `pnpm dev` 실행 후 브라우저로
`http://localhost:2567/playground/` 접속 (Colyseus 공식 devtool, 룸 접속/메시지 전송/상태
확인 가능). 자세한 사용법은 [backend/09](backend/09-work-report-browser-playground.md).

---

## 2. 지금 존재하는 통신 규격

클라이언트 → 서버, `room.send('input', payload)`:
```ts
interface PlayerInputMessage {
  seq: number;      // 클라 입력 시퀀스 번호 (나중에 예측/재조정에 씀)
  moveX: number;     // -1~1
  moveY: number;     // -1~1
  aimAngle: number;  // 라디안
}
```
서버 → 클라, Schema 상태(`room.state.players.get(sessionId)`):
```ts
{ x: number, y: number, aimAngle: number, lastProcessedSeq: number }
```
정의는 [packages/shared/src/protocol/messages.ts](../packages/shared/src/protocol/messages.ts),
[packages/server/src/schema/GameRoomState.ts](../packages/server/src/schema/GameRoomState.ts).
새 메시지 타입을 추가하게 되면 **반드시 타입 검증을 넣을 것** — 이유는 4번 참고.

---

## 3. 자주 마주칠 기술적 함정

- **Colyseus 버전은 0.17**. 인터넷에 흔한 예제(0.14~0.16)와 API가 다르다.
  `new Server()`가 아니라 `defineServer({ rooms: { ... } })` + `defineRoom(RoomClass)`,
  Room은 `state = new MyState()`를 클래스 필드로 직접 할당한다. `@colyseus/schema`의
  `@type()` 데코레이터를 쓰려면 tsconfig에 `experimentalDecorators: true` 필수 — 없으면
  에러 없이 그냥 동기화가 안 된다. 자세히: [backend/06](backend/06-backend-setup-notes.md)

- **pnpm 설치 중 에러가 나도 당황하지 말 것.** `pnpm-workspace.yaml`에 이미
  `autoInstallPeers: false`, `peerDependencyRules`, `allowBuilds` 설정이 들어가 있다.
  새 패키지를 추가하다 `ERR_PNPM_EXOTIC_SUBDEP`(git 기반 네이티브 의존성 차단)나
  `ERR_PNPM_IGNORED_BUILDS`(네이티브 빌드 스크립트 미승인)를 만나면, 그 패키지가 정상
  패키지인지 확인하고 같은 방식으로 `pnpm-workspace.yaml`에 추가하면 된다. 자세히:
  [backend/06 §3](backend/06-backend-setup-notes.md#3-pnpm-트러블슈팅-여기가-제일-중요)

- **TypeScript는 `6.0.3`에 고정돼 있다.** 최신(`7.x`)은 `typescript-eslint`가 아직
  지원하지 않는다(`peerDependencies: <6.1.0`). `pnpm add -D typescript`로 임의로
  올리지 말 것 — 올리면 `pnpm lint`가 깨진다.

- **클라이언트 입력은 절대 신뢰하지 않는다.** 실제로 `moveX`/`moveY` 필드가 빠지거나
  타입이 틀린 입력이 들어와서 좌표가 `NaN`으로 영구 오염되는 버그가 있었다(한 번 `NaN`이
  섞이면 `NaN + 무엇`도 계속 `NaN`). 지금은 `World.setInput()`이 타입까지 검증해서 막고
  있는데, **새 메시지 타입을 추가할 때마다 같은 패턴(타입/범위 검증 후 무시 or 처리)을
  반드시 넣을 것.** 자세히: [backend/10](backend/10-work-report-nan-input-bug.md)

---

## 4. 역할별 파일 분담 ([04-roadmap.md](04-roadmap.md) 기준)

- `shared/sim`: A(서버) = `world.ts`, `movement.ts`, `ai/flowField.ts` /
  B(게임플레이) = `combat.ts`, `building.ts`, `wave.ts` — 지금은 `world.ts`만 있다
- `shared/protocol`의 메시지 타입은 A가 먼저 정의해두는 게 원칙 (지금 `PlayerInputMessage`가
  그 예시) — B/C가 스텁을 짤 때 이 타입을 그대로 참조하면 된다
- `client/net`, `client/render`, `client/ui` 등은 아직 아무것도 없다

---

## 5. 더 자세히 보려면

작업 단위로 기획-과정-결과 형식 보고서가 [backend/](backend/)에 있다. 특히 트러블슈팅
파트는 같은 문제를 또 겪지 않으려고 남긴 것이니, 관련 작업 시작 전에 한 번 훑어보는 걸 권한다.

| 문서 | 내용 |
|---|---|
| [backend/05](backend/05-backend-demo-plan.md) | 예선 데모 압축 일정 (서버 담당 관점) |
| [backend/06](backend/06-backend-setup-notes.md) | 초기 스캐폴딩 — Colyseus API, pnpm 트러블슈팅 |
| [backend/07](backend/07-work-report-input-sync-hardening.md) | seq 응답/aimAngle 동기화/입력 검증 |
| [backend/08](backend/08-work-report-connection-smoke-test.md) | client-server 연결 실제 검증 |
| [backend/09](backend/09-work-report-browser-playground.md) | 브라우저 devtool(Playground) |
| [backend/10](backend/10-work-report-nan-input-bug.md) | NaN 오염 버그 수정 |
