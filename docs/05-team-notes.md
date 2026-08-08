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

- **`PATCH_RATE`는 접속 인원수만큼 대역폭이 곱해진다** — 패치가 클라이언트
  소켓마다 독립적으로 나가기 때문이다. `TICK_RATE`와 같은 60으로 뒀다가
  2인 이상 실접속에서 심하게 끊긴 적이 있어(CPU가 아니라 홈서버 업로드
  대역폭 병목) 20으로 낮췄는데([backend/47](backend/47-work-report-patch-rate-bandwidth.md)),
  그러자 이번엔 예측이 없던 시절이라 자기 캐릭터 반응이 느려져서 다시 60까지
  올렸고, 대역폭 재검증 없이 그대로 방치됐다. 자기 캐릭터 예측
  ([backend/55](backend/55-work-report-player-client-prediction.md))이 들어온
  지금은 반응성 걱정 없이 다시 낮출 수 있는 상태라([backend/61](backend/61-work-report-session-handoff-verification.md)),
  60→**50**으로 낮춰 2인 실접속으로 재확인했다 — 끊김 없음, **50으로 확정**
  (`packages/shared/src/constants.ts`). 몬스터/투사체가 늘어 페이로드가 커지면
  재검증할 것 — `SnapshotInterpolator`가 `PATCH_RATE` 기준으로 보간 지연을 자동으로
  늘려 잡으므로 더 낮출 때도 상수 하나만 바꾸면 된다.

- **저해상도 캔버스를 통째로 확대하지 않는다.** 캔버스는 창 크기(네이티브)로 두고 **월드
  카메라만 정수배로 줌**한다. 한글은 8px에서 판독이 안 되기 때문이다(자소 조합 구조라 최소
  11~12px 필요). 월드 안에 텍스트를 그릴 때는 `text.setResolution(zoom)`을 잊지 말 것 —
  안 하면 작게 그린 글자를 확대하게 되어 뭉개진다.
  자세히: [frontend/04](frontend/04-work-report-resolution-policy.md)

- **`Phaser.Scene`을 상속할 때 `renderer`라는 이름의 프로퍼티를 만들지 말 것.**
  Phaser에 이미 있어서 타입이 충돌한다. 또 `scene: [A, B]` 배열은 **첫 Scene만 자동 시작**되고,
  자동 시작되는 Scene에는 `start(key, data)`의 data가 전달되지 않는다 —
  공유 객체는 `game.registry`로 넘긴다.

- **`setInterval(() => world.tick(1/60), 1000/60)`처럼 고정 dt로 틱하지 말 것.**
  타이머가 불린 횟수만큼만 진행하므로, 프레임이 밀리거나 탭이 백그라운드로 가면
  시뮬레이션 시간이 영구히 사라져 게임 전체가 슬로모션이 된다(실측 41% 속도까지
  떨어진 적 있음). 서버/로컬 양쪽 다 `FixedStepAccumulator`(`shared/sim/fixedStep.ts`)로
  실제 경과 시간을 누적해 고정 스텝 여러 번으로 나눠 돌린다 — 새 틱 루프를 만들 땐
  이 패턴을 재사용할 것. 자세히: [backend/34](backend/34-work-report-develop-merge-combat-accuracy.md)

- **몬스터·투사체·무기 이펙트는 "화면상 가슴 높이"에 그려지지만 판정은 항상 발밑
  월드 좌표다.** 이 둘을 있는 그대로 겹쳐 그리면 총알이 몬스터 머리 위를 스치는
  것처럼 보인다. `render/plane.ts`의 `ACTION_PLANE_Y` 하나로 오프셋을 통일했고,
  조준각 계산(`InputController.updateAim`)도 이 평면 기준으로 커서 좌표를 보정한다 —
  **새로 뭔가를 "전투 평면"에 그릴 땐 반드시 이 상수를 같이 써야** 어긋남이 재발하지
  않는다. 자세히: [backend/34](backend/34-work-report-develop-merge-combat-accuracy.md)

- **"누르고 있는 동안" 상태(홀드 키)는 `PlayerInputMessage`에 필드로 얹는다.**
  moveX/moveY/aimAngle과 같은 자리다 — 매 입력 전송마다 지금 누르고 있는지를
  그대로 실어 보내고, 서버가 그 값을 갖고 진행/중단을 권위 있게 판정한다. 콜로니
  채널링의 `channeling` 필드가 그 예다. 별도 메시지 타입("keyDown"/"keyUp")을
  만들지 않는 이유: 서버는 어차피 "마지막 입력을 새 입력이 올 때까지 매 틱
  반복 적용"하는 모델이라, 이산 이벤트보다 연속 상태 필드가 이 모델과 훨씬 잘
  맞는다. 자세히: [backend/35](backend/35-work-report-monster-colony.md)

- **미니맵(`Minimap.ts`)의 `WORLD_RANGE`는 실제로 표시해야 할 가장 먼 엔티티보다
  넉넉해야 한다.** 콜로니를 맵 가장자리(900px)에 배치했는데 미니맵 범위가
  420px로 남아 있어서, 실제로 존재하는데도 미니맵엔 전혀 안 잡히는 버그가 있었다
  — 새 엔티티를 멀리 배치할 때마다 이 값을 같이 확인할 것.

- **"맵 크기"는 `shared/constants.ts`의 `MAP_SIZE_TILES` 하나만 진짜다.**
  `GameScene.ts`의 카메라 bounds(`setBounds`)가 한때 여기서 안 가져오고
  `TILE_SIZE * 80`이라는 독립된 "임시" 값을 따로 갖고 있었다 — 실제 맵
  (`MAP_SIZE_TILES=128` 기준 ±1024px)보다 훨씬 좁아서(±640px), 그 밖에 있는
  건 카메라가 스크롤 자체를 못 해 "존재하는데 갈 수 없는" 버그가 됐다(콜로니
  배치 후 발견, backend/36). 카메라/렌더 범위를 새로 잡을 땐 항상
  `MAP_SIZE_TILES`를 참조할 것 — 별도 상수를 만들지 말 것.

- **FlowField의 "막힘" 판정(셀, 16px 단위)과 실제 하드 충돌 판정(원, px 단위)은
  해상도가 다르다 — 하나만 믿으면 안 된다.** 정적 장애물(자원 노드/콜로니)을
  FlowField가 우회하도록 셀 단위로 등록해두면 "큰 그림"으로는 경로를 잘
  피해가는 것처럼 보이지만, 그 경로가 셀 경계 안에서 실제 충돌 원(예:
  14px)의 코너를 스치듯 지나가면서 중심까지 파고드는 경우가 실제로
  있었다(500틱 동안 몬스터-콜로니 최소 거리를 추적해서 재현·확인,
  docs/backend/38). 몬스터를 그냥 FlowField 방향으로 이동시키기 직전에
  사거리 기반 하드 스톱(`findBlockingStaticObstacle`류)을 한 번 더 거는 게
  안전하다 — FlowField는 큰 그림의 우회만, 마지막 근접 정밀도는 원 판정이
  따로 담당해야 한다.

- **"멈춰야 하는 거리"를 `attackRange` 같은 다른 용도의 값으로 대신 쓰지
  말 것 — 항상 "두 반경의 합"이어야 한다.** 몬스터가 자원 노드/콜로니
  앞에서 멈추는 `findBlockingStaticObstacle`가 한동안 `attackRange`(보통
  20px)를 그냥 판정 기준으로 썼는데, 이건 **몬스터 자신의 충돌 반경을
  빼먹은 값**이었다. 몸집이 큰 타입(탱커 `hitRadius=9`)일수록 실제
  필요 거리(자기 반경+상대 반경)와 격차가 커져서 그만큼 파고든 뒤에야
  멈췄다 — "자원을 뚫고 다닌다"는 버그 리포트로 발견(docs/backend/39).
  플레이어 쪽(`isBlockedForPlayer`)은 처음부터 `HIT_RADIUS + 상대반경`을
  정확히 쓰고 있었다 — 원 충돌 정지 판정을 새로 짤 땐 항상 이 패턴을
  따를 것, `attackRange`처럼 다른 목적으로 만들어진 값을 재사용하지 말 것.

- **원형 장애물 앞에서 "이동이 막히면 그냥 멈춘다"는 절대 쓰지 말 것 —
  최소한 축 슬라이딩(X만/Y만 시도), 이상적으로는 접선 미끄러짐까지 필요하다.**
  몬스터가 자원 노드/콜로니에 막히면 그 틱은 아무것도 안 하고 완전히
  멈추던 방식(`findBlockingStaticObstacle`, 이제 삭제됨)은 "추격 중이던
  몬스터가 자원 노드 하나에 막혀 영원히 멈춘다"는 버그로 이어졌다
  (docs/backend/40). `movePlayer`가 쓰던 축 슬라이딩(전체 이동이 막히면
  X축만, 그것도 막히면 Y축만)을 그대로 옮겨 붙였는데 **그것만으로도
  부족했다** — 축 슬라이딩은 벽 같은 **직선** 장애물 전제라, 목표가 원형
  장애물 중심과 거의 같은 x 또는 y 좌표에 있으면 X축 이동도 Y축 이동도
  둘 다 다시 원 안으로 파고드는 경우가 실제로 있다(대각선 추격 경로가 자원
  노드를 스치는 상황을 20초 넘게 틱해도 한 픽셀도 안 움직이는 걸로 재현).
  원형 장애물엔 장애물 중심→대상 벡터에 수직인 접선 방향 폴백이 따로
  필요하다 — `moveMonster`의 세 번째 폴백(접선 미끄러짐)이 그 예다. **한
  자리에 영구히 멈춘 엔티티는 다른 버그로도 번진다**: 몬스터가 안 움직이면
  시야각(FOV)도 사실상 고정되므로, 근처를 스쳐 지나가는 플레이어를 다시는
  인지 못 하는 "어그로가 안 잡히는" 버그까지 같이 발생했다 — 원인이 다른
  버그처럼 보여도 뿌리는 "정지 그 자체"인 경우가 있으니, 이동 로직에서
  "완전히 멈춘다"는 결과가 나오면 그게 진짜 의도인지 먼저 의심할 것.
- **스폰 위치는 스폰시키는 오브젝트 자신의 하드 충돌 반경 밖이어야 한다.**
  `tickColonies()`가 몬스터를 콜로니 중심 좌표 그대로(`addMonster(type,
  colony.x, colony.y)`) 스폰시키고 있었는데, 콜로니에 하드 충돌이 생긴
  뒤로는(docs/backend/38) 스폰된 몬스터가 태어나자마자 이미 자기 자신을
  낳은 구조물과 겹친 상태였다 — 이동 검사가 "이미 겹친 상태를 벗어나는"
  경우를 처리해주지 않으면 영원히 그 자리에 낀다(docs/backend/40). 새
  구조물에 하드 충돌을 추가할 때마다, 그 구조물이 뭔가를 "낳는" 스폰 지점
  역할도 하고 있는지 같이 확인할 것.

- **"이동에 성공했다"를 좌표가 바뀌었는지로만 판단하지 말 것 — 그 축의 델타(dx/dy)가
  실제로 0이 아닌지도 같이 봐야 한다.** 몬스터 축 슬라이딩(X만/Y만 시도)에서,
  장애물과 정확히 같은 x 또는 y로 접근하면(흔한 배치) 안 움직이는 축의 "이동
  시도"는 사실 제자리 검사(현재 좌표 그대로)다 — 지금 위치가 우연히 막힘 반경
  밖이면 이 무의미한 제자리 검사가 계속 "성공"으로 잘못 보고된다. "완전히
  멈춘 채 어떤 탈출 로직도 안 켜지는" 상태를 몇 초씩 갇힌 뒤에도 "매 틱 뭔가는
  성공했다"는 이유로 놓칠 뻔했다(docs/backend/42, 탈출 점프 기능을 새로 넣으며
  발견). 이동 성공 여부를 판단하는 코드를 짤 땐 "무언가 True를 반환했다"가
  아니라 "실제로 위치가 달라질 수 있는 시도였는가"까지 확인할 것.
- **클라이언트 외삽(dead reckoning)은 장애물을 전혀 모른다 — 서버가 절대
  허용 안 하는 충돌도 화면에서는 순간적으로 보일 수 있다.** `SnapshotInterpolator`의
  외삽(`extrapolateList`, 스냅샷이 늦게 도착할 때 마지막 속도로 최대
  `MAX_EXTRAPOLATION_MS`(100ms) 앞질러 그리는 dead-reckoning, docs/backend/14)은
  순수 속도 계산이라 자원 노드/콜로니 같은 하드 충돌 장애물을 아예 모른다 —
  빠른 몬스터(보스 돌진 260px/s)는 100ms 안에 노드 지름만큼 미리 그려질 수
  있어서, 서버는 절대 뚫지 않았는데도 화면에서만 순간적으로 장애물을 뚫고
  지나가는 것처럼 보이는 버그가 실제로 제보됐다(docs/backend/42). "서버
  시뮬레이션 버그"로 지레짐작하지 말 것 — 무작위 스트레스 테스트로 서버가
  결백함을 먼저 확인하고 나서야 클라이언트 렌더링(외삽/보간) 쪽을 의심해
  찾아냈다. 외삽/보간에 새 엔티티 타입을 추가하거나 손볼 땐, 그 엔티티가 하드
  충돌 대상 근처를 지나갈 수 있는지도 같이 고려할 것.

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
| [backend/19](backend/19-work-report-flow-field-diagonal-weighting.md) | Flow Field 대각선 가중치 수정 — 이동 경로 꺾임 버그, 다익스트라 정밀도 버그, moveMonster 분리력 버그 |
| [backend/20](backend/20-work-report-monster-aggro-fov.md) | 몬스터 어그로 시야각(120도) 도입 — 방향 계산 3가지 방식 비교, 기존 테스트의 우연 의존 버그 수정 |
| [backend/21](backend/21-work-report-monster-movement-los-steering.md) | 몬스터 이동 자연스럽게 — 옥타일 거리의 근본 한계 진단, 시야선 직진+Flow Field 우회 병행 |
| [backend/22](backend/22-work-report-premature-day-transition-bug.md) | 몬스터가 남았는데 낮으로 바뀌는 버그 — remainingMonsters 스냅샷/스폰 경합, 콜백으로 수정 |
| [backend/23](backend/23-work-report-debug-jump-to-wave.md) | 테스트용 "웨이브 5로 점프" 버튼 — 로컬 모드 전용, GameConnection 옵셔널 메서드로 게이팅 |
| [backend/24](backend/24-work-report-resource-building-mvp.md) | 자원채집·건축 MVP 구현 — 서버/공유 시뮬레이션, 클라이언트(역할 C)는 범위 밖 |
| [backend/25](backend/25-work-report-resource-building-client-placeholder.md) | 자원채집·건축 클라이언트 연결 — 도형 플레이스홀더, Playwright 포커스 이슈 진단 |
| [backend/26](backend/26-work-report-resource-node-clustering.md) | 자원 노드를 군집(클러스터)으로 랜덤 배치 — WorldOptions.rng 주입, 군집 겹침으로 깨진 테스트 수정 |
| [backend/27](backend/27-work-report-building-defense-bugs.md) | 건축물 버그 수정 — 코어 완전 포위 시 몬스터 정지, 벽을 무시하고 코어/타겟 직공격, 투사체가 벽 통과 |
| [backend/28](backend/28-work-report-player-building-collision.md) | 플레이어-건축물 하드 충돌 — 벽/울타리를 캐릭터가 통과하지 못하게 원형 충돌 + 축 슬라이딩 적용 |
| [backend/29](backend/29-work-report-collision-debug-overlay.md) | 플레이어 충돌 반경 디버그 테두리 — C 키 토글, 반경 상수를 shared에서 export해 실제 판정과 일치 보장 |
| [backend/30](backend/30-work-report-boss-attack-patterns.md) | 보스 공격 패턴(돌진/광역) — 예고 후 발동하는 상태 머신, describeBossTelegraph로 서버/로컬 동기화 로직 통합 |
| [backend/31](backend/31-work-report-hitbox-fix-and-resource-rework.md) | 몬스터 히트박스 버그 수정 + 자원채집 재설계(근접 타격 + 코어 입고 + 공유 자원 풀) + 코어 모달 통합 |
| [backend/32](backend/32-work-report-muzzle-gap-miss-bug.md) | 근접 몬스터를 원거리 무기로 못 맞히는 버그(총구 간격 사각지대, muzzleOffset) 수정 + 몬스터 충돌 디버그 테두리 |
| [backend/33](backend/33-work-report-projectile-visual-offset-bug.md) | 총알 궤적(그림)과 실제 피격 위치가 어긋나던 렌더링 오프셋(PROJECTILE_LIFT) 버그 수정 |
