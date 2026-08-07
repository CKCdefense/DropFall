# 작업 보고서 — 플레이어-건축물 하드 충돌(벽/울타리 통과 방지)

> 지금까지 벽·울타리는 몬스터의 이동만 막았고, 플레이어(캐릭터)는 그냥 뚫고 지나다닐
> 수 있었다 — backend/24의 "다음 작업"에 이미 알려진 미구현 항목이었다. 요청받아
> 실제로 구현했다: 플레이어가 `blocksMovement` 건축물(벽/울타리 둘 다)과 겹치는
> 방향으로는 이동할 수 없게 했다.

---

## 1. 기획 — 무엇을, 왜

"캐릭터가 벽을 뚫고 이동할 수 있는 것도 막아줄래? 울타리도 같이"라는 요청. 데이터
파일(`buildings.json`)엔 이미 `fence`/`wall` 둘 다 `blocksMovement: true`가 있었고,
몬스터 쪽은 Flow Field가 이 값을 읽어 우회/공격을 하고 있었다(backend/24, 27) — 하지만
플레이어 이동 코드(`World.tick()`의 `stepPosition` 호출)는 애초에 건축물을 전혀
조회하지 않았다. 즉 데이터와 몬스터 AI는 이미 준비돼 있었고, 플레이어 이동 쪽만
비어 있던 상태였다.

## 2. 과정 — 어떻게 했나

### 2.1 충돌 판정 — 원형 충돌 재사용

기존에 투사체-몬스터/투사체-건축물/근접-몬스터 판정에 이미 쓰던 `circlesOverlap`
(원-원 겹침 판정) 함수를 그대로 재사용했다. 플레이어 반경은 몬스터 근접 판정에 쓰는
`HIT_RADIUS`(10px), 건축물 반경은 투사체-건축물 충돌에 쓰는 `TILE_SIZE/2`(8px)를
그대로 가져와 더했다 — `PLAYER_BUILDING_COLLISION_RADIUS = HIT_RADIUS + TILE_SIZE/2`
(18px). 새 개념을 만들지 않고 기존 반경 값들의 조합으로 정의했다.

`private isBlockedForPlayer(x, y): boolean` — `buildings.values()`를 순회하며
`blocksMovement`가 `false`인 건축물(가구/향후 확장 대비)은 건너뛰고, 나머지는 원형
겹침만 검사한다. 몬스터 쪽 `findBlockingBuildingInRange`와 같은 순회 패턴이다.

### 2.2 이동 처리 — 축 슬라이딩

단순히 "막히면 이동 취소"만 하면, 벽에 대각선으로 다가갈 때 벽과 평행하게라도 이동할
수 있어야 자연스러운데 완전히 멈춰버린다. `private movePlayer(player, moveX, moveY,
dtSeconds)`를 추가해서:

1. 전체 이동(`stepPosition(x, y, moveX, moveY, dt)`)을 시도 — 안 막히면 그대로 적용.
2. 막히면 X축만 이동(`moveY=0`)을 시도 — 안 막히면 적용.
3. 그것도 막히면 Y축만 이동(`moveX=0`)을 시도 — 안 막히면 적용.
4. 셋 다 막히면 그 자리에 그대로 둔다.

흔한 탑다운 2D 게임의 "벽 따라 미끄러지기" 패턴이다. `World.tick()`의 플레이어 이동
루프에서 `stepPosition` 직접 호출 + 대입을 `this.movePlayer(...)` 호출로 교체했다
(`aimAngle`/`lastProcessedSeq` 갱신은 그대로 둠).

## 3. 결과 — 검증

새 테스트 3개 추가(`world-building.test.ts`, `describe('World — 건축물과 플레이어')`):

- 벽 방향으로 계속 이동 입력을 줘도 벽을 뚫고 지나가지 못한다(30초 시뮬레이션 후에도
  플레이어 x좌표가 벽의 x좌표를 넘지 않음).
- 울타리도 동일하게 막는다(벽과 달리 투사체는 통과시키지만 이동은 막아야 한다는
  기존 규칙 그대로).
- 벽에 대각선으로 부딪히는 상황을 정확히 재현(충돌 반경 18px 경계 바로 바깥에
  플레이어를 두고 대각선 입력 한 스텝)해서, x축은 막히고 y축은 그대로 미끄러지는지
  확인 — 축 슬라이딩이 실제로 동작하는 회귀 테스트.

```bash
pnpm --filter @dropfall/shared test     # 128 passed (기존 125 + 신규 3), 5회 연속 안정
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

전부 통과.

## 4. 다음 작업

- 몬스터-건축물 충돌은 여전히 "공격 사거리 안이면 공격, 아니면 Flow Field로 우회"
  방식이라 몬스터끼리는 서로 밀어내는 소프트 분리력만 있고 건축물과는 하드 충돌이
  없다 — 이는 기존 설계(backend/18 §4-6) 그대로이고 이번 변경 범위가 아니다.
- 플레이어가 건축물에 딱 붙어 있는 상태에서 건축물이 파괴되면, 다음 틱부터는 당연히
  막힘이 풀린다(재계산 없이도 매 틱 `isBlockedForPlayer`를 새로 검사하므로 자동으로
  해결됨 — 별도 처리 불필요, 확인만 해 둠).
