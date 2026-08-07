# 작업 보고서 — 콜로니: 접속 인원수만큼 생성 + 사분면별 무작위 위치 + 최소 간격 보장

> 콜로니가 항상 4개·고정 위치(N/E/S/W)였던 걸 "n명 접속 = n개, 각자 무작위
> 위치"로 바꿨다. 핵심 설계 고민은 "인원이 몇 명인지 언제 알 수 있는가"였다 —
> `World` 생성 시점엔 아직 아무도 접속하지 않아 알 수 없다. 그 과정을 §2.1에
> 남긴다.

---

## 1. 기획 — 무엇을, 왜

원문 요청:

> "플레이어 숫자별 콜로니 생성 갯수 조절 (n명 = n개) 그리고 각 콜로니 생성위치
> 랜덤화. 게임 좌표를 4사분면으로 생각해서 각 사분면당 1개의 콜로니만
> 생성되게 + 최대 최소거리 적절히 조정. 추가로 그렇게되면 2개의 콜로니가
> 거의 붙어서 생성될 수도있으니 각 1사분면의 콜로니 위치가 정해지면 그에
> 인접한 콜로니의 위치를 정할때 최소거리가 존재하도록 하는 로직도 추가"

세 가지가 한 세트다: 개수(인원수 연동), 위치(사분면당 1개, 무작위), 최소 간격
(사분면 경계에서 두 콜로니가 붙는 것 방지).

## 2. 과정 — 어떻게 했나

### 2.1 핵심 설계 결정 — "언제 몇 명인지 알 수 있는가"

`World`는 생성자 시점엔 접속 인원을 전혀 모른다:

- **서버**: `GameRoom`의 `private world = new World();`는 `onCreate()`에서
  실행되는데, 이때는 아직 아무도 입장하지 않았다. 플레이어는 `onJoin()`이
  호출될 때마다 `world.addPlayer(...)`로 점진적으로 추가된다. **인원이 최종
  확정되는 시점은 방장이 "시작" 버튼을 눌러 `startGame()`이 실행되는 순간**
  이다 — 그 전까지는 로비에서 자유롭게 들어오고 나갈 수 있다. `update()`도
  `RoomPhase.PLAYING`이 아니면 `world.tick()` 자체를 안 부르므로, 로비 동안
  콜로니가 없어도 시뮬레이션엔 전혀 영향이 없다.
- **로컬 모드**: `LocalConnection` 생성자에서 `addPlayer` 직후 바로
  `setInterval`로 틱을 시작한다(별도 로비 대기 없이 항상 1인).

그래서 콜로니 생성을 `World` 생성자에서 떼어내 **명시적 메서드
`world.startColonies(count: number)`**로 옮겼다 — 인원이 확정된 바로 그
시점에 호출자가 명시적으로 부른다: `GameRoom.startGame()`에서
`this.world.startColonies(this.state.players.size)`, `LocalConnection`
생성자에서 `addPlayer` 직후 `this.world.startColonies(1)`.

카운트를 `World`가 `this.players.size`로 암묵적으로 읽지 않고 **인자로
명시적으로 받게** 한 이유: 테스트에서 "항상 4개"였던 기존 동작을 그대로
유지하고 싶은 곳(하드 충돌/FlowField 테스트 등, 콜로니 개수 자체는 관심사가
아님)은 그냥 `world.startColonies(4)`를 부르면 되고, 새 기능(인원수 연동)을
직접 검증하는 테스트만 다른 값을 넘기면 된다 — `seedResourceClusters(type,
clusterCount, nodesPerCluster)`처럼 이 코드베이스가 이미 쓰는 "명시적 인자"
스타일과도 맞는다.

### 2.2 사분면 배치 + 최소 간격

`ColonyRegistry.seed(count, rng)`(신규, `colony.ts`)가 이제 콜로니를 만든다.
코어를 표준 수학적 사분면(I~IV) 4개로 나누고(사분면 i는 각도
`[i·90°, (i+1)·90°)`), `[0,1,2,3]`을 rng 기반 Fisher-Yates로 섞어 앞에서
`count`개(1~4로 clamp)를 골라 쓴다 — 인원이 적을 때 항상 같은 사분면
조합(예: 늘 북쪽부터)만 나오지 않게 하기 위해서다.

각 사분면 안에서는 `pickQuadrantPosition`이 `world.ts`의
`pickClusterNodePosition`(자원 군집 배치, docs/backend/26·39)과 같은 재시도
패턴(최대 8회)을 쓴다: 사분면 각도 범위 안에서 각도 무작위 +
`spawnRadiusMin~spawnRadiusMax` 거리 무작위로 후보를 뽑고, **이미 배치된
모든 콜로니**(다른 사분면 포함)와 `coloniesData.minSpacing`보다 가까우면
다시 뽑는다. "인접 사분면만" 따로 가리지 않고 전부와 비교하는 이유: 사분면이
4개뿐이라 그게 더 간단하고 안전하다. 8번 다 실패하면 마지막 후보를 그냥
쓴다(무한 재시도 방지 우선, 기존 패턴과 동일).

`coloniesData.spawnRadius`(단일 고정값 900) 하나였던 걸
`spawnRadiusMin`(700)/`spawnRadiusMax`(1000)로 나누고, `minSpacing`(400)을
추가했다 — 셋 다 감으로 잡은 값이라 플레이테스트 후 조정 대상이다.

### 2.3 부수 확인 — 미니맵 범위

`spawnRadiusMax`가 900→1000으로 늘면서 기존 `Minimap.ts`의
`WORLD_RANGE`(950)를 넘어선다 — 그대로 두면 backend/36과 같은 종류의 버그
(멀리 있는 엔티티가 미니맵에 아예 안 잡힘)가 재발한다. `WORLD_RANGE`를
1050으로 올렸다.

### 2.4 기존 테스트 정리

`colony.test.ts`/`world-building.test.ts`의 `createTestWorld()` 헬퍼에
`world.startColonies(4)`를 추가해서, 콜로니 개수/존재를 전제하는 기존
테스트(하드 충돌, FlowField 우회 등)의 동작을 그대로 보존했다. "4개가
spawnRadius만큼 떨어진 고정 위치에 배치된다" 테스트는 전제 자체가 바뀌므로
다시 썼다 — 이제 "거리가 min~max 사이인지", "서로 다른 사분면인지"(각도로
사분면 인덱스 계산)를 확인한다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 17 files, 260 tests 전부 통과(신규 4개)
pnpm --filter @dropfall/server typecheck   # 순차 실행(동시 -r 실행 시 이 환경 OOM)
pnpm --filter @dropfall/client typecheck
pnpm lint      # 에러 0
pnpm build     # client(vite)/server(tsup) 전체 통과
```

신규 테스트(`colony.test.ts`):
- 인원수만큼만(1~4명) 콜로니가 생기는지.
- 사분면 수(4)를 넘는 값(7)을 넘겨도 4개로 clamp되는지.
- 여러 시드(20회 반복)로 어떤 두 콜로니 쌍도 `minSpacing`보다 가깝지 않은지
  — 요청의 "인접 콜로니 최소거리" 항목을 직접 검증.
- 시드가 다르면 콜로니 위치도 달라지는지(고정 위치가 아님을 확인).

## 4. 다음 작업

- **밸런스 값 임의값** — `spawnRadiusMin`(700)/`spawnRadiusMax`(1000)/
  `minSpacing`(400) 모두 플레이테스트 후 조정 대상이다.
- **자원 군집/코어 건설 반경과의 상호작용은 검증하지 않았다** — 콜로니 범위
  (700~1000)가 자원 군집 범위(코어에서 최대 ~580, docs/backend/39)와는 안
  겹치지만, 코어 최고 티어 건설 반경(900)과는 겹칠 수 있다. 이번 요청 범위
  밖이라 손대지 않았다 — 필요해지면 별도 작업으로 다룬다.
