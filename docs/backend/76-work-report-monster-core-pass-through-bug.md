# 76. 작업 보고서 — 몬스터가 코어를 뚫고 지나가는 버그 수정

## 기획

사용자 제보(스크린샷 첨부): "해당 스크린샷처럼 몬스터가 코어를 통과할 수 있는
상태가 되는 경우가 있어". 스크린샷은 코어와 그 옆에 선 플레이어를 보여준다 —
몬스터가 코어 받침대를 그대로 뚫고 반대편으로 나가는 상황.

## 과정

### 원인 — "코어는 몬스터의 목표라 안 막는다"는 규칙이 절반만 맞았다

`World.isBlockedForMonster()`는 처음부터(docs/backend/38) 코어를 의도적으로
빼 놓고 있었다. 주석 그대로: "코어도 다루지 않는다 — 몬스터의 목표 자체라
막으면 안 된다." 몬스터가 코어 자체를 향해 직행할 때는 `coreDistance(monster.x,
monster.y) <= data.attackRange`가 이동보다 먼저 걸려 발자국 가장자리 앞에서
멈추고 공격으로 전환되므로(§tickMonsterAI 코어 직행 분기), 실제로 이 규칙은
문제없이 맞았다.

**문제는 몬스터가 코어가 아니라 플레이어를 쫓을 때였다.** `resolveAggroTarget`이
플레이어를 찾으면, 몬스터는 `monster.facingX/facingY`(플레이어 방향)로 그냥
`moveMonster()`를 부른다 — 이 경로는 코어 발자국 안인지 전혀 안 본다. 코어
반대편에 선 플레이어를 쫓으면, 자원 노드·콜로니는 피해 우회하면서(같은
`isBlockedForMonster`가 막으므로) 코어만은 그대로 뚫고 지나갔다.

### 왜 지금까지 안 걸렸나

- 코어 근처는 자원 노드/콜로니가 상대적으로 적어(콜로니는 700~1000px 밖) 몬스터가
  대개 곧장 코어로 몰리는 그림이 많고, "플레이어가 코어 정확히 반대편에 서 있는"
  상황 자체가 실전에서 자주 안 만들어졌다 — 하지만 파밍하다 코어 옆에 서 있는
  플레이어를, 반대쪽에서 스폰된 몬스터가 아그로 잡고 달려오면 바로 재현된다
  (아그로 반경이 넓은 타입일수록, 그리고 코어가 좁아서 — 8각 발자국 반폭이
  52px밖에 안 된다 — 더 자주 걸린다).

### 수정 — `isBlockedForMonster`에 코어를 추가

```ts
if (coreDistance(x, y) < monsterR) return true;
```

한 줄 추가로 끝났다. 부작용을 걱정할 필요가 없는 이유:

- **코어를 직접 노리는 경로는 이 판정에 닿을 일이 없다.** `monsters.json`의
  모든 타입에서 `attackRange > hitRadius`다(가장 좁은 데몬도 20 vs 6). 즉
  이동이 코어 발자국에 물리적으로 닿기(`coreDistance < hitRadius`) **한참
  전에** 이미 공격 사거리 조건(`coreDistance <= attackRange`)에 걸려 이동
  자체를 멈추고 공격으로 넘어간다 — 두 조건의 순서가 항상 이렇게 되도록
  데이터가 짜여 있어서, 새 충돌 판정이 옛 "코어를 향해 걷는" 흐름과 절대
  마주치지 않는다.
- **거구 보스(`crushesObstacles`)는 그대로 통과한다** — `isBlockedForMonster`는
  `crushes`가 true면 첫 줄에서 바로 반환하므로 자원 노드/콜로니와 마찬가지로
  코어도 안 막는다. 덩치 큰 보스가 코어에 막혀 멈추는 그림도 이상했을 것이다.
- **우회 폴백(축 슬라이딩·접선 미끄러짐·탈출 점프)이 전부 같은
  `isBlockedForMonster`를 재사용**하므로, 코어를 새로 막아도 그 앞에서 완전히
  얼어붙지 않고 자원 노드·콜로니를 우회하던 것과 똑같이 옆으로 미끄러진다.
  다만 접선 미끄러짐의 방향 계산(`findNearestObstacleCenter`)은 자원
  노드·콜로니만 알고 코어를 몰라서, 코어 하나만 막고 있는 상황이면 그 폴백은
  후보를 못 찾고 건너뛸 뻔했다 — 플레이어용 버전
  (`findNearestObstacleCenterForPlayer`)이 이미 쓰던 방식 그대로("코어는
  원이 아니라 8각형이지만 접선 방향만 필요한 용도로는 원점 근사로 충분하다")
  몬스터용에도 코어를 추가해 맞췄다.

### 검증 — 고쳐지기 전엔 실제로 재현됨을 먼저 확인

회귀 테스트를 짜고, 고치기 **전** 코드에 그대로 돌려서 실패를 먼저 확인했다
(`git stash`로 수정분만 잠깐 되돌림) — `minCoreEdgeDistance`가 0까지 떨어져서
몬스터가 발자국 한가운데까지 파고들었음을 확인. 수정을 되돌려 놓은 뒤 같은
테스트가 통과함을 재확인했다.

테스트: 코어를 사이에 두고 몬스터(hellhound, 아그로 반경 240)와 플레이어를
반대편에 세우고(거리 300, 아그로 반경 안), 500틱(0.1초씩) 동안 몬스터 궤적
전체에서 `coreDistance(monster.x, monster.y)`의 최솟값을 추적 — 몬스터
반경(hellhound hitRadius=6) 밑으로 한 번도 안 내려가면 통과다.

## 결과

- `packages/shared/src/sim/world.ts`:
  - `isBlockedForMonster()` — 코어 발자국 충돌 추가(`coreDistance(x, y) <
    monsterR`), 주석을 새 근거로 갱신.
  - `findNearestObstacleCenter()` — 접선 미끄러짐용 코어 후보 추가
    (플레이어용 헬퍼와 같은 원점 근사 방식).
- `packages/shared/tests/world-building.test.ts`: 회귀 테스트 1건 추가
  (describe 제목에 docs/backend/76 링크 추가). 고치기 전 코드로 실패 재현 →
  고친 뒤 통과를 직접 확인.
- 재검증: shared 593/593(신규 1건 포함) 통과, server typecheck·test(31)
  통과, client typecheck·build 통과, `pnpm lint` 통과.
