# 작업 보고서 — 몬스터 스폰/이동 로직 구체화 (군집 분리 · 어그로 히스테리시스 · 스폰 지점 순환)

> [backend/15](15-work-report-combat-monster-wave.md)에서 만든 몬스터 스폰/이동 MVP를
> 다시 들여다보고, 기술명세가 요구하지만 안 넣었던 것과 실제로 어색하게 동작할 수 있는
> 부분 세 가지를 다듬었다.

---

## 1. 기획 — 무엇을, 왜

backend/15 구현을 다시 검토하면서 세 가지 구멍을 찾았다.

1. **군집 분리(separation)가 없었다.** [기술명세 §5.3](../02-tech-spec.md#53-개체-행동-필드-위에-얹는-레이어)은
   개체 행동 레이어에 "군집 분리: 같은 셀에 겹치지 않도록 간단한 separation 벡터 가산"을
   명시하는데, backend/15는 이걸 빼고 구현했다. 그 결과 여러 마리가 같은 목표(코어, 또는
   같은 플레이어)로 몰리면 완전히 겹쳐서 스택된다.
2. **어그로 타겟이 매 틱 재계산됐다.** `findNearestPlayer()`를 `tickMonsters()`가 매 틱
   그대로 호출해서, 두 플레이어가 아그로 반경 경계 부근에 걸쳐 있으면 "가장 가까운
   플레이어"가 프레임마다 바뀔 수 있다 — 몬스터가 이동 방향을 계속 바꿔 떨리는 것처럼
   보인다.
3. **스폰 지점이 완전 무작위였다.** `Math.floor(rng() * spawnPoints.length)`로 매번
   무작위 선택이라, 지점이 2~3곳이어도 확률적으로 한쪽에 몰릴 수 있다.

셋 다 팀 협의가 필요한 항목이 아니라(수치/밸런스가 아니라 로직 자체의 완성도 문제),
바로 구현했다.

---

## 2. 과정 — 어떻게 했나

### 2.1 스폰 지점 순환 — `shared/sim/wave.ts`

`spawnPointCursor` 필드를 추가해서 `spawnPoints[cursor % spawnPoints.length]`로 순서대로
순환시켰다. `beginNextWave()`에서 웨이브마다 0으로 리셋한다. 무작위 회전각(`buildSpawnPoints`의
`rotation`)은 그대로 둬서 웨이브마다 스폰 위치 배열 자체는 여전히 달라지되, 그 안에서
지점 소비 순서만 결정론적으로 바꿨다.

### 2.2 어그로 히스테리시스(leash) — `shared/sim/world.ts`

`MonsterEntity`에 `targetPlayerId?: string`을 추가하고, `resolveAggroTarget()`을 새로
만들었다:

- 이미 타겟이 있고 그 타겟이 살아있고(`hp > 0`) 아그로 반경의 `AGGRO_LEASH_MULTIPLIER`(1.5)배
  안에 있으면 **그대로 유지**한다.
- 아니면(타겟이 없거나, 죽었거나, leash 밖으로 나갔으면) `findNearestPlayer()`로 새로
  탐색한다.

한 번 물면 좀 더 오래 쫓다가, 확실히 멀어지거나 죽어야 놓는 구조다 — 게임에서 흔히
"디텍션 반경 vs 리쉬 반경"을 분리하는 방식 그대로다.

### 2.3 군집 분리 — `shared/sim/world.ts`

- `computeSeparation(monster)`: 분리 반경(`SEPARATION_RADIUS = HIT_RADIUS * 2.5`, 25px)
  안의 다른 몬스터들로부터 밀어내는 벡터를 합산한다. 가까울수록 가중치가 크다
  (`(반경 - 거리) / 반경`).
- `moveMonster(monster, dirX, dirY, speed, dt)`: 주 이동 방향(추격 방향 또는 Flow Field
  방향)에 분리 벡터를 `SEPARATION_WEIGHT`(0.6) 가중치로 더한 뒤 정규화해서 이동시킨다.
  분리력이 주 방향을 완전히 덮어쓰지 않도록 가중치를 1보다 작게 뒀다 — 그래야 몬스터가
  서로 밀어내는 동안에도 코어/플레이어 쪽으로 전진은 계속한다.
- 몬스터 수가 최대치(성능 목표 기준 150마리)여도 O(n²) 비교는 22,500회 수준이라 60Hz
  틱 예산에 문제없다고 판단했다(별도 프로파일링은 안 함 — 필요해지면 공간 분할로
  최적화).

### 2.4 테스트

`wave.test.ts`에 스폰 지점 순환 검증 1개 추가(2웨이브 스폰 지점 2곳에 스폰 횟수가
균등하게 나뉘는지). `world-combat.test.ts`에 6개 추가:
- 군집 분리 2개 (가까이 겹치면 벌어짐 / 멀리 있으면 서로 영향 없음)
- 어그로 히스테리시스 3개 (leash 안이면 유지 / leash 밖이면 타겟 상실 / 타겟이 다운되면
  다른 대상으로 전환)

**겪은 문제**: 새 테스트 대부분이 `startFirstWave()` 직후 몬스터가 **1마리만** 스폰된
상태를 가정하고 있었다(스폰 간격이 있어서 한 번에 다 안 나온다). 2마리 이상 필요한
분리 테스트가 처음에 `monsters[1]`이 `undefined`라 실패했다 — `spawnAtLeast(world, count)`
헬퍼를 새로 만들어 필요한 만큼 스폰될 때까지 잘게 틱하도록 고쳤다.

---

## 3. 결과 — 검증

```bash
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm --filter @dropfall/shared test     # 82 passed (기존 76 + 신규 7 - 리팩터로 인한 변동 없음)
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

전부 통과.

---

## 4. 다음 작업

- `AGGRO_LEASH_MULTIPLIER`(1.5), `SEPARATION_RADIUS`(25px), `SEPARATION_WEIGHT`(0.6)는
  전부 임의값이다. 실제로 여러 몬스터가 몰리는 그림을 보고 나서(클라이언트 렌더링이
  붙은 뒤) 조정이 필요할 수 있다.
- 여전히 "막힘 감지"(다음 셀이 `blocksMovement`이고 우회 비용이 크면 건축물 공격,
  [기술명세 §5.3](../02-tech-spec.md))는 건축 시스템이 없어서 미구현 상태다.
- 분리 벡터 계산이 지금은 전체 몬스터 목록을 매번 순회(O(n²))한다. 몬스터 수가
  실제로 150마리에 근접하는 웨이브가 만들어지면 공간 분할(그리드 버킷 등)로 최적화가
  필요할 수 있다 — 지금은 필요성이 확인되지 않아 안 함.
