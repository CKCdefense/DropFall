# 팀 공유 노트 — 작업 시작 전에 알아야 할 것

> `packages/shared`, `packages/server`, `packages/client` 세 패키지가 모두 세팅됐다.
> 상세 결정/트러블슈팅은 [backend/](backend/) · [frontend/](frontend/)에 작업 단위로
> 기록돼 있으니, 여기서는 **지금 당장 알아야 할 것만** 요약한다.

---

## 1. 로컬에서 돌려보기

```bash
# pnpm이 없으면 먼저
corepack enable && corepack prepare pnpm@latest --activate

pnpm install
pnpm dev        # 클라(5173) + 서버(2567) 동시 기동
pnpm dev:client # 클라만
pnpm dev:server # 서버만
pnpm test       # packages/shared 유닛 테스트
pnpm typecheck  # 전 패키지 타입 검사
pnpm lint
pnpm build
```

게임은 `http://localhost:5173` 에서 뜬다.

**서버 동작만 눈으로 확인하고 싶으면**: `http://localhost:2567/playground/` (Colyseus 공식
devtool). 자세한 사용법은 [backend/09](backend/09-work-report-browser-playground.md).

**혼자 2인 접속을 테스트하려면** 탭 두 개를 이렇게 연다 (로비 폼을 건너뛰는 딥링크):
```
http://localhost:5173/?create=1&nickname=호스트&roomName=테스트방&password=pw
http://localhost:5173/?room=<위에서 뜬 방 코드>&nickname=게스트&password=pw
```

**서버 없이 클라이언트만 만지려면** `http://localhost:5173/?local=1` —
`shared/sim`을 브라우저 안에서 그대로 돌린다.

**스모크 테스트** (서버를 띄운 상태에서):
```bash
pnpm --filter @dropfall/server smoke        # 연결/입력/동기화/잘못된 입력 방어
pnpm --filter @dropfall/server smoke:lobby  # 방 생성/코드/목록/비밀번호 검증
```

---

## 2. 지금 존재하는 통신 규격

클라이언트 → 서버, `room.send('input', payload)`:
```ts
interface PlayerInputMessage {
  seq: number;      // 단조 증가. 되감기면 서버가 무시한다
  moveX: number;     // -1~1
  moveY: number;     // -1~1
  aimAngle: number;  // 라디안
}
```
클라이언트 → 서버, `room.send('fire', payload)` (이동과 달리 클릭할 때마다 1번 보내는
이산 이벤트 — 위치/조준각은 서버가 이미 아는 값을 쓰므로 안 실어보낸다):
```ts
interface FireInputMessage {
  weaponId: string;  // 'club' | 'pistol' (shared/data/weapons.json)
}
```
클라이언트 → 서버, `room.send('skipVote')` (페이로드 없음 — 낮 페이즈일 때만 유효,
접속 전원이 보내야 즉시 밤으로 전환된다. 만장일치, [backend/16](backend/16-work-report-defeat-and-day-skip-vote.md)):

서버 → 클라, Schema 상태 ([backend/15](backend/15-work-report-combat-monster-wave.md)로
몬스터/투사체/코어, [backend/16](backend/16-work-report-defeat-and-day-skip-vote.md)로
`hp`/`skipVoteCount` 추가):
```ts
{
  roomCode: string, roomName: string, hasPassword: boolean,
  players: Map<sessionId, { nickname, x, y, aimAngle, lastProcessedSeq, hp }>,
  monsters: Map<id, { type, x, y, hp, maxHp }>,
  projectiles: Map<id, { x, y }>,
  coreHp: number, coreMaxHp: number,
  wavePhase: 'day' | 'night' | 'victory' | 'defeat', currentWave: number,
  skipVoteCount: number,  // 필요 정족수 = players.size (만장일치)
}
```

**패배 조건**: 코어 HP 0 또는 접속 중인 플레이어 전원이 다운(hp 0)되면 즉시
`wavePhase: 'defeat'`. 다운된 플레이어는 웨이브를 클리어하고 다음 낮이 시작되면 자동으로
전원 부활한다(HP 풀회복). 몬스터는 다운된 플레이어를 추격/공격 대상으로 삼지 않는다.

**입력은 `INPUT_SEND_RATE`(= `TICK_RATE`, 현재 60Hz — [backend/13](backend/13-work-report-tick-rate-60hz.md)로
20Hz에서 상향)로 보낸다.** 서버는 마지막 입력을 새 입력이 올 때까지 매 틱 반복 적용하므로,
렌더 프레임보다 빠르게 보내봐야 중간 입력이 덮어써져 버려진다. 정지하려면 `moveX/moveY = 0`을
**명시적으로 보내야 한다**.

방 생성/참여 옵션, 방 코드 규칙, 입장 거절 코드는
[frontend/02-lobby-room-protocol.md](frontend/02-lobby-room-protocol.md)에 정리돼 있다.

정의는 [packages/shared/src/protocol/](../packages/shared/src/protocol/),
[packages/server/src/schema/GameRoomState.ts](../packages/server/src/schema/GameRoomState.ts).
새 메시지 타입을 추가하게 되면 **반드시 타입 검증을 넣을 것** — 이유는 3번 참고.

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

- **서버 빌드는 `tsc`가 아니라 tsup이다.** `tsc` + `moduleResolution: "bundler"` 조합은
  확장자 없는 상대 import를 그대로 뱉어서 `node dist/index.js`가 죽는다. 게다가
  `@dropfall/shared`는 TS 소스를 그대로 export하므로 번들에 인라인해야 한다.
  타입 검사는 `pnpm typecheck`(`tsc --noEmit`)로 분리돼 있다.
  자세히: [frontend/03](frontend/03-work-report-client-setup.md)

- **Colyseus는 시뮬레이션 틱과 상태 전송 주기가 별개다.** `setSimulationInterval`을 아무리
  올려도 `Room.patchRate`(기본 20Hz)를 안 건드리면 **클라이언트는 20Hz로만 본다.**
  실제로 `TICK_RATE`만 60으로 올렸다가 실효 15.9Hz로 돌던 적이 있다. 지금은
  `PATCH_RATE` 상수와 `GameRoom`의 `this.patchRate` 설정으로 묶여 있다.
  **클라이언트 보간 지연도 틱이 아니라 `PATCH_RATE` 기준**으로 잡아야 한다.
  자세히: [frontend/05](frontend/05-work-report-patch-rate.md)

- **저해상도 캔버스를 통째로 확대하지 않는다.** 캔버스는 창 크기(네이티브)로 두고 **월드
  카메라만 정수배로 줌**한다. 한글은 8px에서 판독이 안 되기 때문이다(자소 조합 구조라 최소
  11~12px 필요). 월드 안에 텍스트를 그릴 때는 `text.setResolution(zoom)`을 잊지 말 것 —
  안 하면 작게 그린 글자를 확대하게 되어 뭉개진다.
  자세히: [frontend/04](frontend/04-work-report-resolution-policy.md)

- **`Phaser.Scene`을 상속할 때 `renderer`라는 이름의 프로퍼티를 만들지 말 것.**
  Phaser에 이미 있어서 타입이 충돌한다. 또 `scene: [A, B]` 배열은 **첫 Scene만 자동 시작**되고,
  자동 시작되는 Scene에는 `start(key, data)`의 data가 전달되지 않는다 —
  공유 객체는 `game.registry`로 넘긴다.

---

## 4. 역할별 파일 분담 ([04-roadmap.md](04-roadmap.md) 기준)

- `shared/sim`: A(서버) = `world.ts`, `movement.ts`, `ai/flowField.ts`, `combat.ts`, `wave.ts` /
  B(게임플레이) = `building.ts` — 원래 분담표는 combat/wave를 B로 뒀지만, 압축 일정상
  A가 [backend/15](backend/15-work-report-combat-monster-wave.md)에서 먼저 구현했다.
  전체 흐름은 [06-client-server-state-flow.md](06-client-server-state-flow.md) 참고
- `shared/protocol`의 메시지 타입은 A가 먼저 정의해두는 게 원칙 (지금 `PlayerInputMessage`가
  그 예시) — B/C가 스텁을 짤 때 이 타입을 그대로 참조하면 된다
- `client/`는 C가 담당한다. 구조와 경계는
  [frontend/01-client-architecture.md](frontend/01-client-architecture.md) 참고 —
  특히 **렌더링은 `GameConnection` 인터페이스에만 의존**하므로, 서버 상태 모양이 바뀌면
  `ColyseusConnection`만 고치면 된다

---

## 5. 에셋 작업

원본은 [assets/](../assets/)에서만 작업하고, `pnpm build:atlas`로
`packages/client/public/assets/`에 산출물을 만든다. 산출물은 **커밋한다**(Aseprite CLI가
없는 팀원도 클론 즉시 실행 가능해야 하므로). 명명 규칙·규격은
[assets/README.md](../assets/README.md), 파이프라인 근거는
[frontend/07](frontend/07-asset-pipeline.md).

**바이너리는 머지가 안 된다** — 같은 에셋 파일을 두 명이 동시에 수정하지 말 것.
아틀라스 리빌드는 한 명만 한다.

---

## 6. 더 자세히 보려면

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
| [backend/11](backend/11-mvp-scope-proposal-combat-wave.md) | 전투·몬스터·웨이브 MVP 범위 제안(팀 협의) |
| [backend/12](backend/12-work-report-snapshot-interpolation.md) | 스냅샷 보간으로 20Hz 렌더링 끊김 보강 |
| [backend/13](backend/13-work-report-tick-rate-60hz.md) | 서버 틱레이트 20Hz → 60Hz 상향 |
| [backend/14](backend/14-work-report-extrapolation.md) | 보간 버퍼 부족 시 외삽(dead reckoning) 추가 |
| [backend/15](backend/15-work-report-combat-monster-wave.md) | 전투·몬스터·웨이브 MVP 구현 (서버 시뮬레이션) |
| [backend/16](backend/16-work-report-defeat-and-day-skip-vote.md) | 전원 다운 즉시패배 + 낮 스킵 투표(만장일치) 구현 |
| [backend/17](backend/17-work-report-monster-spawn-movement-refinement.md) | 몬스터 스폰/이동 구체화 — 군집 분리·어그로 히스테리시스·스폰 지점 순환 |
| [backend/18](backend/18-mvp-scope-proposal-resource-building.md) | 제안서 — 자원채집·건축(나무/돌, 도끼/곡괭이, 벽/울타리) MVP 범위 |
