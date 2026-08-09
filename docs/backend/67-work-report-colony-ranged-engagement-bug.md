# 67. 작업 보고서 — 원거리로 콜로니를 farm하면 트리클 없이 즉시 정화되던 버그 수정

## 기획

사용자 피드백(원문):

> 콜로니는 무한생성하게 해달라니까 왜 몇마리 뽑고 이전처럼 사라지는거야?

`docs/backend/62-work-report-colony-trickle-spawn.md`(게임 흐름 피드백 #3)에서
콜로니 저장분이 바닥나도 플레이어가 트리거 반경(240px) 안에 있으면 트리클
주기로 계속 수호대가 나오게 고쳤는데도, 실제 플레이에서는 여전히 몇 마리만
잡으면 콜로니가 정화(빈 껍데기화)돼 버린다는 신고였다.

## 과정

### 1. 원인 진단

`tickColonyGuards()`의 "교전 중"(`triggered`) 판정이 **근접 거리만** 봤다:

```ts
const triggered = this.anyAlivePlayerWithin(colony.x, colony.y, coloniesData.triggerRadius);
```

`coloniesData.triggerRadius`는 240px인데, 원거리 무기의 사거리(`weapons.json`의
`maxRange`)는 최대 900px까지 나온다(예: 저격 라이플). 원거리 무기로 수호대를
잡는 건 지극히 정상적인 플레이인데, 그 플레이 방식 자체가 항상 트리거 반경
밖에서 일어난다 — 마지막 수호대를 원거리에서 처치하는 바로 그 순간
`guardIds.size===0 && stored<=0 && !triggered`(플레이어가 240px 밖)가 전부
참이 되어 **즉시 정화**된다. 트리클이 시작될 틈조차 없다 — 신고된 "몇 마리
잡으면 예전처럼 사라진다" 증상과 정확히 일치한다.

`colony.test.ts`의 트리클 관련 테스트들은 전부 플레이어를 콜로니 코앞(60px,
트리거 반경 안)에 고정해 두고 검증하고 있어서 이 근접 전제 자체가 깨지는
시나리오를 커버하지 못하고 있었다 — 그래서 기존 테스트는 다 통과하는데 실제
플레이에서는 깨지는 전형적인 커버리지 공백이었다.

### 2. 수정 — "교전 중" 판정에 원거리 피격 유예 추가

`ColonyEntity`에 `engagedTimer`(초) 필드를 추가했다. 소속 수호대가 (죽지 않는
히트든 킬샷이든) 맞을 때마다 `World.damageMonster()`가 이 값을
`COLONY_ENGAGE_GRACE_SECONDS`로 리필한다. `tickColonyGuards()`의 `triggered`
판정을 "근접 반경 안 **또는** engagedTimer > 0"으로 바꿔서, 원거리로 계속
때리고 있으면 물리적으로 트리거 반경 밖이어도 "교전 중"으로 인정한다.

`COLONY_ENGAGE_GRACE_SECONDS`는 `guardTrickleSeconds`(트리클 소환 주기)에 1초
버퍼를 더한 값이다 — 정확히 같은 값을 쓰면, 계속 원거리로 교전을 이어가도
"다음 트리클 수호대가 뜨는 바로 그 순간" 유예와 소환 쿨다운이 동시에 0으로
떨어지는 경합이 생겨서 그 타이밍에 소환이 막히고 곧바로 정화로 이어질 수
있다(테스트로 실제 재현). 버퍼를 둬서 다음 수호대가 뜰 때까지는 반드시
"교전 중"이 유지되게 했다.

`engagedTimer` 감소는 `triggered` 판정보다 **먼저** 한다 — 판정 뒤에 감소시키면
유예를 넘기는 큰 dt(테스트가 몰아 치는 경우 등)가 한 틱 안에서 "유예가 이미
끝났는데도 그 틱은 여전히 교전 중"으로 잘못 읽혀서, 실제로 유예가 끝난 뒤에도
한 틱을 더 기다려야 하는 오차가 생긴다.

### 3. 테스트

- 회귀 테스트 추가(`colony.test.ts`): 트리거 반경(240) 밖·리시 반경(360) 안
  거리에서 콜로니를 한 번 근접으로 깨운 뒤, 계속 그 거리에서만 처치를 이어가는
  시나리오를 재현 — 저장분이 다 떨어져도 정화되지 않고, 트리클 주기가 지나면
  새 수호대가 그 자리에서 계속 나오는지 확인한다.
- 기존 트리클 테스트 3개("트리클 대기 중에 플레이어가 떠나면 정화된다" +
  `purifyByCombat` 헬퍼를 쓰는 2개)는 킬샷도 이제 `engagedTimer`를 채우므로,
  "떠난 뒤 즉시 정화"가 아니라 "떠난 뒤 유예(`COLONY_ENGAGE_GRACE_SECONDS`)가
  지나야 정화"로 전제가 바뀌어서 대기 시간을 갱신했다.

## 결과

- `packages/shared/src/sim/colony.ts`: `ColonyEntity.engagedTimer` 필드 추가.
- `packages/shared/src/sim/world.ts`: `COLONY_ENGAGE_GRACE_SECONDS` 상수 추가,
  `tickColonyGuards()`의 `triggered` 판정에 반영, `damageMonster()`가 수호대
  피격마다(치명타 포함) 갱신하도록 수정.
- `packages/shared/tests/colony.test.ts`: 회귀 테스트 1개 추가, 기존 3개 테스트의
  "떠난 뒤 대기 시간"을 새 유예에 맞게 갱신.
- 재검증: colony.test.ts 5회 연속 재실행 안정(18/18) + shared 전체 561/561 +
  server typecheck·test(31) + client typecheck + lint 전부 통과.

이제 근접이든 원거리든 콜로니 수호대와 계속 교전 중이기만 하면(피격이 끊기지
않으면) 저장분이 바닥나도 정화되지 않고 트리클로 계속 나온다 — "몇 마리 잡으면
사라진다"는 신고의 실제 원인(거리 기반 판정이 원거리 플레이를 반영 못 함)을
해결했다.
