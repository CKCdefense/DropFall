# 작업 보고서 — 자원채집·건축 MVP 구현(서버/공유 시뮬레이션)

> [backend/18](18-mvp-scope-proposal-resource-building.md) 제안서의 남은 미확정 항목을
> 확인한 뒤, 제안서 §5의 서버(역할 A) 하위 작업 10단계를 그대로 구현했다. 클라이언트
> 렌더링/입력은 backend/15(전투·웨이브)와 같은 흐름으로 이번 범위 밖에 뒀다.

---

## 1. 기획 — 무엇을, 왜

제안서 §4에 팀/사용자 확인이 필요한 질문이 남아 있어서, 코드에 실제로 영향을 주는
세 가지만 먼저 확인했다:

- **도끼 겸용 여부** → 겸용(제안서 원안). `weapons.json`에 `axe`를 근접무기로 추가.
- **곡괭이 겸용 여부** → 순수 도구(제안서 원안, 전투 데미지 없음).
- **역할 B 작업 여부** → B가 별도로 진행 중이지 않아 A가 그대로 진행.

나머지(자원 노드 배치 수량/위치, 밤 채집 가능 여부 등)는 제안서 자체가 이미
"플레이스홀더, JSON에 넣어 나중에 코드 수정 없이 조정"이라고 명시한 밸런스 값이라
직접 결정값을 넣고 진행했다(§3 참고).

## 2. 과정 — 어떻게 했나

### 2.1 설계 결정(코드 구조에 영향을 준 것들)

1. **도구 소유권 시스템을 만들지 않았다.** 지금 무기(`fire(weaponId)`)도 플레이어별
   소유권 검사가 없다(누구나 어떤 weaponId든 쏠 수 있다) — 상점 시스템 자체가 없으니
   "도구를 갖고 있는지" 검사할 대상이 없다. `resources.json`의 `requiredTool`은
   문서화 목적으로만 남겨뒀다(나중에 상점이 생기면 그 스키마를 그대로 쓸 수 있게).
2. **채집(`harvest`)은 상태 없는 단발 액션이다.** 원거리 무기 `fire()`가 클라이언트의
   매 홀드 프레임 재전송 + 서버 쿨다운 조합으로 "연사"를 구현하는 것과 똑같은
   패턴이다. "E 홀드 채널링"은 클라이언트가 나중에 반복 전송하는 방식으로 구현할
   UX이지, 서버가 들고 있어야 할 상태 머신이 아니다.
3. **건축물 점유는 셀 좌표 O(1) 인덱스가 필요했다.** `FlowField.hasLineOfSight`/
   `isBlocked` 콜백이 몬스터마다 매 틱 여러 번(직선 경로 위 여러 셀) 호출되므로,
   건축물 Map을 매번 선형 스캔하면 건물이 늘어날수록 눈에 띄게 느려진다.
   `building.ts`에 `BuildingRegistry`를 만들어 id→건물 맵과 `"cx,cy"`→id 맵을
   같이 관리한다(`WeaponCooldowns`와 같은 위상의 소형 상태 클래스).
4. **자원 노드는 RNG 없이 고정 배치했다.** 몬스터 스폰 지점과 달리 웨이브마다
   회전시킬 이유가 없다 — 코어 중심 고정 원 위에 균등 배치(wood 10개 반경 180px,
   stone 6개 반경 220px, 전부 플레이스홀더). 덕분에 테스트도 결정론적이다.
5. **몬스터의 건축물 공격은 반경 기반으로 단순화했다.** 기술명세 §5.3의 "우회 비용
   비교"를 정밀하게 구현하는 대신, 기존 근접 판정과 같은 규칙을 썼다 — 살아있는
   목표(추격 타겟 → 코어)가 항상 최우선이고, 이동해야 하는데 공격 사거리 안에
   이동을 막는 건축물이 있으면 그것부터 공격한다.
6. **하드 충돌은 만들지 않았다.** 지금 시뮬레이션엔 어떤 엔티티도 하드 충돌이
   없다(몬스터끼리도 소프트 분리력만 있음) — Flow Field/시야선 우회가 "막힘"의
   유일한 메커니즘이고, backend/19~21에서 만들어 둔 인프라를 그대로 썼다.
   투사체-건축물 충돌(`blocksProjectile` 실제 적용)도 데이터 필드만 만들고
   `resolveProjectileHits()`는 손대지 않았다.

### 2.2 데이터 (`packages/shared/src/data/`)

`resources.json`(나무/돌), `tools.json`(도끼/곡괭이 → 채집 자원 매핑),
`buildings.json`(울타리/벽, 제안서 §3.4 값 그대로)을 신규 추가하고, 기존
`weapons.json`에 `axe`(근접, damage 18/fireRate 1.5/range 24)를 넣었다.
`data/index.ts`에 기존 `WeaponDataSchema` 패턴을 그대로 복제해 zod 스키마 3세트를
추가했다.

### 2.3 `packages/shared/src/sim/building.ts` (신규)

`BuildingEntity`(cx/cy로 점유·Flow Field 판정, x/y로 `circlesOverlap` 같은 기존
월드좌표 판정 재사용)와 `BuildingRegistry`(place/canPlace/remove/get/values/entries/
isBlockedForMovement/isBlockedForProjectile)를 만들었다.

### 2.4 `packages/shared/src/sim/world.ts` (가장 큰 변경)

- `PlayerEntity`에 `wood`/`stone` 필드 추가.
- `ResourceNodeEntity`(type/x/y/remainingHarvests/respawnTimer) 추가, 생성자에서
  고정 배치로 시딩.
- `FlowField` 생성 시 `isBlocked` 콜백을 실제로 연결했다 — 지금까지(backend/19~21)
  기본값 `() => false`였던 걸 `(cx,cy) => this.buildings.isBlockedForMovement(cx,cy)`로
  바꿨다. 코어 셀 재계산 로직은 `recomputeFlowField()`로 뽑아내서 생성자/건축
  설치/건축물 파괴 시 재사용한다.
- `harvest(playerId)`: 플레이어 위치 기준 반경 안의, 고갈 안 된 가장 가까운 노드를
  찾아(근접 무기 판정과 같은 반경 스캔) `harvestInterval` 쿨다운을 적용해 채집한다.
- `placeBuilding(playerId, buildingType, cx, cy)`: 원시 타입 검증 → 맵 범위 →
  셀 점유 → 코어 셀 → 자원 노드 셀 → 플레이어가 서 있는 셀(요청자 본인 포함) →
  자원 충분 여부를 차례로 검사하고, 통과하면 자원 차감 + 배치 + Flow Field 재계산.
- `tickMonsters()`: 이동해야 하는 두 분기(추격 타겟이 사거리 밖 / 코어가 사거리 밖)
  모두에 "공격 사거리 안의 이동 차단 건축물이 있으면 그것부터 공격" 체크를 추가했다.
  건축물 HP가 0이 되면 제거하고 Flow Field를 다시 계산한다.
- `tickResourceNodes(dtSeconds)`: 고갈된 노드의 리스폰 타이머를 감소시키고 다 되면
  채집 가능 상태로 되돌린다.

### 2.5 프로토콜/서버

`protocol/messages.ts`에 `BuildInputMessage`(buildingType/cx/cy) 추가 —
`harvest`는 페이로드가 없어서(`voteSkipDay`처럼) 새 타입이 필요 없었다.
`GameRoomState.ts`에 `PlayerSchema.wood/stone`, `ResourceNodeSchema`,
`BuildingSchema`를 추가하고, `GameRoom.ts`에 `harvest`/`placeBuilding` 메시지
핸들러(기존 `fire`/`skipVote`와 동일한 형태)와 `syncResourceNodes()`/
`syncBuildings()`(`syncMonsters()`와 동일한 diff-and-update 패턴)를 연결했다.

### 2.6 겪은 문제 — 테스트가 실제로는 구현이 아니라 테스트 설정의 실수였던 3가지

`world-building.test.ts`를 처음 작성했을 때 4개가 실패했는데, 원인을 하나씩
확인해보니 전부 구현 버그가 아니라 테스트 좌표 설계 실수였다:

1. **건축 성공 테스트가 실패** — builder를 `(500,500)`에 두고 바로 그 자리에
   지으려 했는데, "플레이어가 서 있는 셀엔 못 짓는다" 규칙이 배치 요청자 본인에게도
   적용된다(제안서 §3.5 원문 그대로 — 실제 게임에서도 발밑이 아니라 옆에 짓는 게
   자연스럽다). 목표 셀을 본인 위치와 다른 셀로 옮겨서 해결.
2. **건축물 파괴 테스트가 실패** — 몬스터를 코어에서 20px(= attackRange+CORE_RADIUS
   미만인 36px 안)에 둬서, 몬스터가 건축물 대신 코어를 계속 공격하고 있었다(설계
   결정 5의 "코어가 건축물보다 우선" 그대로 작동한 것). 몬스터를 코어 사거리 밖으로
   옮겨서 해결.
3. **추격 타겟 우선순위 테스트가 실패** — 타겟 플레이어를 몬스터의 `aggroRadius`(120)
   보다 먼 190px에 둬서 애초에 어그로 자체가 안 잡히고 있었다. 120 안으로 옮겨서 해결.

세 가지 다 실제 구현이 문서에 적은 대로 정확히 동작하고 있다는 뜻이라, 버그
수정이 아니라 테스트 좌표 재계산으로 끝났다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test     # 122 passed (기존 97 + 신규 25), 5회 연속 실행 안정
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

서버를 실제로 기동시켜서(`pnpm --filter @dropfall/server dev`) 새 Colyseus 스키마
(`ResourceNodeSchema`/`BuildingSchema`)와 메시지 핸들러가 런타임에서(데코레이터
등록 포함) 에러 없이 로드되는 것도 확인했다(포트 충돌로 리슨만 실패, 그 전까지의
부팅 로그는 전부 정상 — 이미 이전 세션에서 띄워 둔 서버가 포트를 쥐고 있었을
뿐이다).

전부 통과.

## 4. 다음 작업

- **클라이언트(역할 C)**: 렌더링(자원 노드/건축물 표시), 입력(B 건축모드 토글,
  그리드 스냅 UI, E 홀드로 `harvest` 반복 전송, `placeBuilding` 메시지 전송)이
  전부 이번 범위 밖이다. backend/15(전투·웨이브)가 서버만 먼저 구현되고 이후
  클라이언트가 별도로 붙은 것과 같은 흐름을 그대로 따랐다.
- **플레이어-건축물 하드 충돌**: 지금은 벽을 지어도 플레이어가 그냥 통과해서
  걸어 다닐 수 있다. 몬스터도 마찬가지로 Flow Field/시야선 우회만 하지 물리적으로
  막히지는 않는다 — 지금 시뮬레이션 전체가 하드 충돌이 없는 구조라 이번에 새로
  만들지 않았다.
- **투사체-건축물 충돌**: `blocksProjectile` 데이터 필드는 있지만
  `resolveProjectileHits()`가 건축물을 아직 검사하지 않는다(플레이어 투사체가
  벽을 그냥 통과한다). 울타리가 "투사체는 통과, 이동은 차단"이라는 제안서 §1의
  차별점이 실제로 드러나려면 이 처리가 필요하다.
- **도구 소유권/상점 시스템**: 지금은 모두가 모든 도구를 가진 것처럼 동작한다.
  상점이 생기면 `tools.json`을 실제 소유권 검사에 연결해야 한다.
- **자원 노드 배치 값 튜닝**: 개수(10/6)·반경(180px/220px)은 전부 임의값이다.
  실제 플레이 감각을 보고 조정이 필요할 수 있다.
