# 작업 보고서 — 내 캐릭터 클라이언트 예측(prediction) + 재조정(reconciliation)

> 멀티플레이 중 "화면이 정지했다가 한 번에 튀는(텔레포트)" 제보를 조사한 끝에,
> 원인이 패치 크기도 대역폭도 아니라 **내 캐릭터조차 네트워크 도착 시각에
> 100% 의존해서 그려지고 있었다**는 것으로 좁혀졌다. 카메라가 그 위치를 lerp=1로
> 무보정 추종하므로, 지터로 위치 신호가 흔들리면 화면 전체가 흔들렸다. 내
> 캐릭터만 입력 즉시 로컬에서 먼저 움직이고(예측) 서버 확정 위치로 나중에
> 맞추는(재조정) 구조를 넣었다.

---

## 1. 기획 — 무엇을, 왜

원문 요청 요약: "지금 멀티 지연시간 어느정도인지 확인해줄래?"로 시작해,
팀원이 공유한 분석 아티팩트("멀티 플레이 화면 텔레포트·끊김 원인 분석")를
같이 검토하고, 실측(DevTools WS 패널)으로 그 문서의 가설 중 어떤 게 맞는지
좁혀 나갔다. 사용자가 최종적으로 요청한 것: "PATCH_RATE를 40으로 되돌리면
너무 느려서 원활한 게임이 불가능하다 — 다른 최적화 지점은 어디냐"에 대한
답으로 자기 캐릭터 클라이언트 예측을 제안했고, 승인받아 진행했다.

## 2. 과정 — 어떻게 했나

### 2.1 조사 — 원인을 하나씩 검증하며 좁혔다

1. **공유받은 분석 문서 대조**: `PATCH_RATE=60`, `INTERP_DELAY_MS≈33ms`,
   `MAX_EXTRAPOLATION_MS=100`, `perMessageDeflate threshold:1024`,
   `SnapshotInterpolator.push()`가 서버 시각이 아니라 클라이언트 도착 시각
   (`performance.now()`)으로 타임라인을 구성한다는 점, `EntityRenderer.
   syncPlayers()`가 로컬/원격을 구분 안 한다는 점, 카메라가
   `startFollow(sprite, true, 1, 1)`(lerp=1)로 무보정 추종한다는 점 — 전부
   코드 대조로 사실 확인했다.
2. **실측으로 대역폭/압축 가설 기각**: 실제 배포본(GitHub Pages + Tailscale
   Funnel)에 Playwright로 접속해 DevTools Network→WS→Messages를 직접
   확인했다. 몬스터 무리가 스폰되는 순간을 포함해 패치 크기가 **계속 100B
   이하**였다 — "스폰 몰림이 패치를 키워 압축 임계값을 넘긴다"는 가설과
   "대역폭이 인원수에 곱해져 병목"이라는 가설 둘 다 이 상황에서는 근거가
   빠졌다.
3. **"호스트만 렉 걸린다" 제보 조사**: 게임플레이 중 `hostSessionId`를
   참조하는 코드가 로비 단계(누가 시작 버튼을 누를 수 있는가)에만 있고
   게임 진행 중에는 전혀 없음을 확인 — 코드상 호스트를 특별 취급하는 경로가
   없어, 그 제보는 역할이 아니라 그 개인의 회선/기기 문제였을 가능성이
   높다고 결론 냈다(사용자도 본인 테스트에서 호스트/참가자 둘 다 문제
   없었다고 확인).
4. **남은 것은 크기가 아니라 타이밍**: 사용자가 "보간 예측과 실제 카메라
   이동 간의 차이 아니냐"고 물어, 실제로는 "두 신호가 어긋나는 것"이 아니라
   "신호가 하나뿐이고 그 신호(내 캐릭터 위치) 자체가 네트워크 도착 시각에
   전부 의존한다"는 점을 설명했다 — 카메라는 그 신호를 그대로 복사할 뿐
   자체 스무딩이 없다(의도적 설계, 픽셀아트 떨림 방지).

### 2.2 설계 — 왜 가능했는가

`packages/shared/src/sim/movement.ts`의 기존 주석이 이 작업을 이미
예고하고 있었다: "서버(`World`)와 클라이언트 예측이 같은 코드를 쓰기 위해
분리했다." `stepPosition`/`normalizeMoveVector`는 이미 순수 함수였지만,
`World.movePlayer`의 축 슬라이딩 폴백과 충돌 판정(`isBlockedForPlayer`)이
아직 `World` 클래스 private 메서드라 클라이언트가 못 썼다.

충돌 판정 재료(건물/자원노드/콜로니 좌표, `circlesOverlap`, `coreDistance`,
`buildingsData`/`resourcesData`)는 전부 이미 `@dropfall/shared`에서
export 중이었고, 클라이언트는 `WorldSnapshot`으로 이미 그 좌표를 받고
있었다(`SnapshotInterpolator`가 외삽 장애물 판정에 이미 같은 데이터를
씀) — **프로토콜 변경이 전혀 필요 없었다.**

### 2.3 구현

- **`shared/sim/movement.ts`**: `resolvePlayerMove(x, y, moveX, moveY,
  dtSeconds, speedMultiplier, isBlocked)` 추가 — `World.movePlayer`의
  3단 폴백(전체→X만→Y만)을 충돌 판정 콜백으로 일반화한 순수 함수.
- **`shared/sim/playerCollision.ts`**(신규): `isPlayerBlocked(x, y,
  buildings, resourceNodes, colonies)` — `World.isBlockedForPlayer`의
  4가지 검사(건물/자원노드/콜로니/코어 8각 발자국)를 그대로 옮겼다. 인자를
  `{type,x,y}[]`/`{type,x,y,hp}[]`/`{x,y}[]` 최소 구조 타입으로 받아서
  서버 엔티티와 클라이언트 `*View` 타입 양쪽 다 어댑터 없이 넘길 수 있게
  했다. `PLAYER_BUILDING_COLLISION_RADIUS`/`PLAYER_COLONY_COLLISION_RADIUS`
  상수도 이 파일로 옮겼다.
- **`shared/sim/world.ts`**: `movePlayer`/`isBlockedForPlayer`를 위 두
  함수를 호출하는 얇은 래퍼로 리팩터(행동 변화 없음 — 기존 회귀 테스트
  487개가 리팩터 전후 그대로 통과하는 것으로 확인).
- **`client/net/PlayerPredictor.ts`**(신규): 표준 입력 예측 + 재조정.
  `applyInput(seq, moveX, moveY, speedMultiplier, isBlocked)`으로 즉시
  로컬 위치를 전진시키고 미확인 입력 큐에 쌓는다. `reconcile(serverSeq,
  serverX, serverY, isBlocked)`은 서버가 인정한 시점으로 되감은 뒤 그
  이후 입력을 재생해 예측 위치를 복원한다. dt는 항상 `1/TICK_RATE`
  고정값(서버가 `FixedStepAccumulator`로 항상 고정 스텝만 도는 것과 동일
  이유 — 가변 dt는 결정성을 깬다).
- **`client/game/input/InputController.ts`**: 생성자에 `onInputSent?:
  (input) => void` 콜백 추가, 두 전송 지점(`update()`, `haltMovement()`)
  모두에서 `sendInput()` 직후 호출.
- **`client/game/render/EntityRenderer.ts`**: `sync(snapshot,
  localOverride?)` / `syncPlayers(views, localOverride?)` — 지정한 id의
  플레이어만 스냅샷 좌표 대신 예측 좌표로 그린다. `SnapshotInterpolator`
  내부 버퍼 객체를 직접 mutate하지 않는 안전한 방식이다(보간기가 같은
  객체 참조를 재사용해서 직접 덮어쓰면 보간기 상태가 오염된다). 걷기/정지
  애니메이션 판정(`updatePlayerSprite`)도 옛 보간 신호가 아니라 실제
  렌더 좌표를 받도록 같이 고쳤다 — 안 고치면 예측으로는 부드럽게
  움직이는데 다리 애니메이션만 멈춰 있는 새로운 불일치가 생겼을 것이다.
- **`client/game/scenes/GameScene.ts`**: `PlayerPredictor` 보유(첫
  스냅샷에서 지연 초기화). 매 프레임 순서: ①스냅샷에서 장애물 목록
  갱신 → ②`predictor.reconcile()` → ③`input_.update()`(새 입력을
  보냈으면 `onInputSent`가 `predictor.applyInput()` 호출) → ④예측
  좌표로 `entityRenderer.sync()` — reconcile/applyInput을 sync보다
  먼저 해서, 이번 프레임에 보낸 입력이 한 프레임 지연 없이 바로 화면에
  반영되게 했다. 카메라(`startFollow`)는 코드 변경 없음 — 이미
  `entityRenderer.getSprite(me.id)`를 따라가므로 자동으로 혜택을 받는다.
  오프라인 모드(`LocalConnection`)도 분기 없이 같은 경로를 탄다.

### 2.4 구현 중 발견한 것 — 스프린트

구현 도중 팀원이 동시에 push한 커밋(캐릭터 기초 스탯)에 **스프린트**
(Shift, 속도 1.6배, 스태미나 소모)가 추가된 걸 발견했다. 처음 계획에는
없던 변수라, 예측이 이걸 모르면 스프린트 중 매 프레임 되당김이 보였을
것이다. 다행히 클라이언트가 스프린트 여부(키 상태)를 이미 알고 있어서
(`InputController`가 서버로 보내는 바로 그 입력에 실려 있음) 정보 없이도
반영 가능했다 — `SPRINT_SPEED_MULTIPLIER`를 world.ts에서 export하고,
`PlayerPredictor`가 입력마다 그 배율을 받아 큐에 같이 저장했다가 재조정
재생 때도 같은 배율로 재현하게 했다.

**남은 한계**: 스태미나 보너스(영구 스탯)와 소모품 속도 버프는
`PlayerView`에 실려 오지 않아 예측이 배율 1로 계산한다(스프린트 자체의
스태미나 고갈 여부도 마찬가지) — 그 상태일 때만 예측이 서버보다 살짝
어긋났다가 재조정 때 짧게 보정된다. 프로토콜 확장 없이 감수했다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 498/498 (신규 34건 포함)
pnpm --filter @dropfall/server typecheck
pnpm --filter @dropfall/server test        # 31/31
pnpm --filter @dropfall/client typecheck
pnpm lint
```

Playwright로 로컬 dev 서버(`?local=1`, 오프라인 시뮬레이션)에 접속해
확인:
- WASD로 이동 시 예상 물리(100px/s × 유지 시간)와 정확히 일치하는 거리만
  이동함을 좌표 디버그 표시로 확인(x:80→160, 0.8초 유지 → 정확히 +80px).
- 코어 방향으로 계속 이동해도 코어 발자국 경계에서 정확히 멈추고
  뚫고 들어가지 않음을 확인(리팩터된 `isPlayerBlocked` 충돌 판정이
  정상 동작).
- 콘솔 에러는 라이센스 몬스터 아틀라스 부재로 인한 기존 예상된 에러뿐
  (이번 작업과 무관, `queueMonsterAtlas`가 도형 플레이스홀더로 대체).

실제 배포 서버 대상 네트워크 지터 재현 테스트(인위적 지연 주입 등)는
이번 범위에서 하지 않았다 — 로컬에서는 지터가 사실상 0이라 예측/재조정이
거의 매 프레임 즉시 수렴해 차이를 육안으로 확인하기 어렵다. 실제 효과는
다음에 여러 명이 실접속해서 체감으로 확인해야 한다.

## 4. 다음 작업

- 원격 플레이어/몬스터는 여전히 순수 보간이라 지터에 취약함 — 저비용
  안전판으로 보간 지연에 절대 시간 하한(`max(2패치, 50ms)`)을 추가하는
  게 다음 후보.
- 스냅샷에 서버 틱 타임스탬프를 실어 도착시각 대신 서버시각 기준으로
  재생하면 원격 엔티티 텔레포트의 근본 해결이 됨 — 재조정에도 같은 값을
  쓸 수 있어 자연스러운 다음 단계.
- 스태미나 보너스/소모품 속도 버프를 프로토콜에 실어 예측 정확도를 마저
  올리는 것도 가능하나, 지금은 §2.4의 한계로 감수.

## 5. 후속 수정 — 재조정이 seq와 좌표가 안 맞는 값을 쓰던 버그

"다음 작업"에 적어 둔 "실제 다인 배포 환경에서 체감 재확인"을 사용자가
직접 해봤고, "움직임이 부자연스럽고 약간의 버벅임이 있다"는 제보로
돌아왔다 — 로컬(지터 0) 테스트에서는 안 보이던 문제였다.

**원인**: `GameScene.update()`가 `predictor.reconcile()`에 넘긴
`(seq, x, y)`가 사실 서로 다른 시점의 값이었다. `connection.getSnapshot()`
(=`SnapshotInterpolator.sample()`)의 `x`/`y`는 **두 원본 패치를 보간(lerp)한
값**인데, `lastProcessedSeq`는 보간하지 않고 그중 더 최신 패치의 값을 그대로
쓴다(`blendList`가 `{...target, x: lerp(...), y: lerp(...)}`로 만드는
구조 — `target`은 최신 패치, `x`/`y`만 옛 패치와 섞임). 재조정은 "서버가
이 seq를 이 좌표로 확정했다"는 전제로 그 지점부터 대기 입력을 재생하는데,
그 좌표가 실제로는 그 seq 시점의 위치가 아니라 "두 시점 사이 어딘가"였다 —
그래서 패치가 도착할 때마다(초당 PATCH_RATE회) 미세하게 어긋난 위치로
스냅됐다가 다시 재생되는 게 반복되며 버벅임으로 보였다.

**수정**: `SnapshotInterpolator`에 `getRawPlayer(id)`를 추가해 **보간을
거치지 않은, 가장 최근에 도착한 원본 패치**에서 플레이어를 그대로 찾게
했다 — 이러면 좌표와 seq가 반드시 같은 패치에서 나온 쌍이다.
`GameConnection` 인터페이스에 `getRawSelf()`를 추가하고
`ColyseusConnection`/`LocalConnection` 둘 다 이 메서드로 위임하게 한 뒤,
`GameScene`이 재조정에는 `getRawSelf()`(원본)를, 그 외(입력 처리 등)에는
기존 `getSnapshot()`(보간)를 쓰도록 나눴다.

```bash
pnpm --filter @dropfall/client typecheck
pnpm --filter @dropfall/server typecheck
pnpm lint
```

## 6. 후속 수정 — 채팅/개발자 콘솔이 게임 종료 후에도 화면에 남는 버그

같은 제보에서 같이 들어온 별개 버그: "채팅이 게임을 종료해도 계속
남아있고 겹치는 문제가 있어."

**원인**: `ChatBox`/`DevConsole`은 DOM 오버레이라 Phaser 캔버스 밖(
`document.body`)에 직접 붙는데, 정리 코드가 `Phaser.Scenes.Events.SHUTDOWN`
한 곳에만 걸려 있었다. 그런데 "나가기"(`main.ts`의 `leaveRoom`)는 씬을
정상적으로 stop/restart하는 게 아니라 **`Phaser.Game` 자체를
`destroy(true)`로 통째로 부순다** — 이 경로는 SHUTDOWN을 거치지 않고 곧장
내부 오브젝트를 정리해서, DOM 오버레이 정리 콜백이 아예 안 불렸다. 그
결과 채팅 로그(`.df-chat`, `position: fixed`)가 로비 화면 위에 그대로
겹쳐 남았다.

**수정**: `createGame.ts`가 리사이즈 리스너 정리에 이미 쓰고 있던
`Phaser.Core.Events.DESTROY`(게임 레벨, `game.destroy()`에서 반드시 발생)에도
같은 정리 콜백을 추가로 걸었다 — `destroy()` 자체가 멱등(두 번 불려도
안전)이라 SHUTDOWN이 오든 안 오든 최소 한 번은 확실히 정리된다.

```bash
pnpm --filter @dropfall/client typecheck
```
Playwright로 로컬 dev 서버에서 재현·확인: 수정 전엔 ESC→나가기 후에도
`document.querySelectorAll('.df-chat').length`가 1로 남아있었고, 수정 후엔
0으로 확인됐다.

## 7. 후속 수정 — 입력 전송 주기와 렌더 주기가 어긋나는 프레임의 계단식 움직임

§5 수정 이후에도 "아직도 버벅이는 느낌이 있다"는 제보가 왔다. 코드를
다시 보니 남은 원인 후보가 하나 더 있었다 — 이번엔 네트워크와 무관한,
순수 로컬 렌더링 구조 문제다.

**원인**: `PlayerPredictor.applyInput()`은 **입력 전송 주기(60Hz,
`INPUT_SEND_RATE`)에만 맞춰** 예측 위치를 전진시킨다 — 서버와 정확히 같은
고정 스텝을 써야 재조정 재생이 어긋나지 않기 때문이다(§2.3). 그런데
`GameScene.update()`(렌더 루프)는 이 주기와 무관하게, 브라우저 주사율만큼
돈다 — 60Hz 모니터에서도 두 주기가 완전히 같은 위상으로 안 맞으면 프레임마다
위치가 멈춰 있다가 한 스텝씩 튀고, 고주사율(120/144Hz) 모니터에서는 이
간극이 훨씬 더 자주 보인다. `renderPosition()` 없이 `position`(예측
기준점)을 매 프레임 그대로 그렸으므로, 원격 엔티티(항상 부드럽게 보간되는)와
달리 **내 캐릭터만 계단식으로 보이는** 구조였다.

**수정**: `PlayerPredictor`에 `renderPosition()`을 추가했다 — 예측
기준점(`x`/`y`, 재조정이 참조하는 값)은 그대로 두고, 마지막으로 적용한
입력의 방향·배율로 그 이후 지난 시간만큼(최대 `MAX_RENDER_LOOKAHEAD_MS
=100ms`, `SnapshotInterpolator`의 `MAX_EXTRAPOLATION_MS`와 같은 안전장치)
짧게 미리 내다본 값을 순수 화면용으로 계산해 돌려준다. `GameScene`이
`localOverride`를 만들 때 `position` 대신 이걸 쓰도록 바꿨다.

```bash
pnpm --filter @dropfall/shared test        # 498/498(영향 없음, shared 미변경)
pnpm --filter @dropfall/client typecheck
pnpm lint
```

**측정의 한계**: Playwright(자동화 브라우저, 실제 디스플레이 vsync 없이
CDP로 구동)로 프레임별 좌표를 찍어 계단 패턴을 확인해보려 했으나, 자동화
환경 자체의 rAF 타이밍이 고르지 않아 신뢰할 수 있는 비교가 어려웠다 —
그래서 이 수정의 실제 체감 효과는 실제 브라우저(실제 모니터 주사율)에서
사용자가 직접 재확인해야 한다.

## 8. 후속 수정 — 미니맵의 내 점만 여전히 순간이동하는 버그

실제 플레이 중 "미니맵상 내 캐릭터가 원래 위치보다 한참 우측(맵 끝
근처)까지 갔다가 원래 자리로 돌아온다"는 제보가 왔다. 처음엔 §5와 같은
네트워크 정체(입력이 한동안 안 나가다 몰려서 재조정이 크게 되감기는 것)를
의심해 사용자에게 DevTools Network→Socket→Messages 캡처를 요청했는데,
캡처된 구간은 패킷이 3~24ms 간격으로 고르게 오는 완전히 정상적인
구간이었고 Console 에러도 없었다 — 그 가설은 기각됐다.

**원인**: `HudScene.update()`가 미니맵에 좌표를 넘길 때 `GameScene`의
`PlayerPredictor`를 전혀 모른 채 `connection.getSnapshot()`(보간된 값)을
그대로 썼다. `Minimap.update()`도 `snapshot.players`를 그대로 찍었다. 즉
**월드 화면의 내 캐릭터 스프라이트는 예측으로 매끈해졌는데, 미니맵 점은
GameScene의 예측 보정이 전혀 안 닿는 별도 경로**(HudScene은 다른 Scene이라
GameScene의 private 필드에 직접 접근할 수 없다)로 그려지고 있었다 — 그래서
이번에 고친 그 텔레포트 버그가 미니맵에서만 그대로 재현된 것이었다.

**수정**: 기존에 씬 간 공유에 쓰던 `registry` 패턴(`INPUT_CONTROLLER_KEY`
등과 같은 방식)을 그대로 따라 `LOCAL_POSITION_KEY`를 추가했다. `GameScene.
update()`가 매 프레임 예측 좌표(`localOverride`)를 이 키로 registry에
올리고, `HudScene.update()`가 그걸 읽어 `Minimap.update(snapshot,
sessionId, localPosition)`에 함께 넘긴다. `Minimap`은 내 점을 찍을 때만
스냅샷 좌표 대신 이 값을 쓴다(값이 없으면 — 예측이 아직 초기화 전이면 —
기존처럼 보간 좌표로 자연히 폴백).

**비슷한 위험이 있는 다른 곳(이번엔 안 건드림)**: `PlacementPreview.update()`
도 `me`를 보간된 스냅샷에서 받지만, 실제로 좌표를 쓰는 곳은
"자기 자신이 서 있는 칸엔 못 짓는다"는 겹침 검사뿐이라 지터가 있어도
그 칸 판정이 아주 잠깐 흔들리는 정도라 미니맵처럼 눈에 띄지 않는다 — 낮은
우선순위로 남겨둔다.

```bash
pnpm --filter @dropfall/client typecheck
pnpm lint
```

Playwright로 로컬 dev 서버(`?local=1`)에서 배선 자체는 확인했다(이동 시
미니맵 점이 정상적으로 따라 움직임, 콘솔 에러 없음) — 다만 버그 자체가
네트워크 지터가 있어야 드러나는 것이라 로컬(지터 0) 환경에서는 재현·재검증이
안 된다. 실제 재현 여부는 다음 실접속 테스트에서 확인해야 한다.
