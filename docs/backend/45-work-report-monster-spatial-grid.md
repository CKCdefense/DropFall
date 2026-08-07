# 작업 보고서 — 몬스터 공간 분할 격자(SpatialGrid) 도입

> "몹이나 투사체가 많아지면 같이 플레이하다 렉이 심해진다"는 제보를 조사해서
> `computeSeparation`(몬스터 군집 분리)과 `projectileHitsMonster`(투사체 충돌
> 판정) 등이 매 틱 몬스터 전체를 순회하는 O(M²)/O(P×M) 패턴이었던 걸 확인하고,
> 균일 격자(SpatialGrid) 기반으로 "근처 칸만 본다"로 바꿨다.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "지금 같이 플레이하면서 proj나 몹이 많아지면 많이 끊기는 문제가
있는데 어디서 발생하는건지 확인해줄래?" → 원인 확인 후 "작업 진행해보자"로
수정까지 진행.

## 2. 과정 — 어떻게 했나

### 2.1 원인 — 60Hz 틱 안의 두 O(n²)급 순회

- `computeSeparation`(`world.ts`): 몬스터 M마리가 매 틱 서로를 밀어내는
  군집 분리 벡터를 계산하는데, 몬스터마다 "다른 모든 몬스터"를 순회한다 —
  M×M. 몹 150마리면 틱당 22,500회.
- `resolveProjectileHits` → `projectileHitsMonster`: 투사체마다 몬스터
  전체를 순회 — P×M. `applyMeleeHit`/`resolveMuzzleGapHit`도 같은 패턴.

둘 다 60Hz로 도는 코드라, 개체 수가 늘면 틱 하나가 16.6ms를 넘기고 그
틱의 상태 브로드캐스트가 접속한 전원에게 같이 늦어진다.

### 2.2 SpatialGrid — 균일 격자, 64px 칸

`packages/shared/src/sim/spatialGrid.ts`(신규): `insert`/`remove`/
`updateEntry`/`queryRadius`만 있는 최소 클래스. `queryRadius`는 정확한
원-원 판정을 하지 않는다 — 반경이 걸치는 칸들의 id 후보만 돌려주고, 최종
판정(`circlesOverlap` 등)은 호출자가 마저 한다.

`World`가 `monsterGrid` 하나를 들고 다니며 네 곳을 바꿨다:
- `computeSeparation`: 전체 순회 → `queryRadius(monster.x, monster.y, SEPARATION_RADIUS)`
- `projectileHitsMonster`: → `queryRadius(projectile.x, projectile.y, MAX_MONSTER_HIT_RADIUS)`
  (몬스터 타입별 히트박스 최댓값을 더해야 큰 몬스터가 격자 반경 밖 중심을
  가져도 몸이 걸치는 경우를 안 놓친다)
- `applyMeleeHit`: → `queryRadius(hit.originX, hit.originY, hit.range + MAX_MONSTER_HIT_RADIUS)`
- `resolveMuzzleGapHit`: → `queryRadius(player.x, player.y, gapLength + MAX_MONSTER_HIT_RADIUS)`

### 2.3 그리드를 "살아있게" 유지하기 — 두 번의 시행착오

**1차: `moveMonster`에 증분 갱신만.** 몬스터가 이동할 때마다
`try { moveMonsterInner(...) } finally { monsterGrid.updateEntry(...) }`로
그리드를 갱신하게 했다. `addMonster`/`damageMonster`/`monsters.clear()`
4곳도 짝을 맞춰 그리드를 같이 건드리게 했다.

**여기서 테스트 5개가 실패했다.** 원인: 기존 테스트들이 `monster!.x = 5`처럼
반환받은 엔티티의 좌표를 **직접 대입**해서 시나리오를 세팅하는 패턴을 쓰고
있었다 — `moveMonster`를 거치지 않으니 그리드가 그 변경을 모른다. 그 상태로
`world.fireWeapon()`을 곧바로 부르면(틱 없이) 격자는 몬스터가 옛 자리에
있다고 믿은 채라 근접/투사체 판정이 빗나갔다.

**2차: 진입점마다 통째로 다시 채우는 안전망 추가.**
`rebuildMonsterGrid()`(O(M), 그냥 clear 후 전부 insert)를 만들어서
`fireWeapon()`과 `tickMonsters()` 시작 시점에 호출한다. `moveMonster`를 안
거치는 어떤 경로로 좌표가 바뀌어도(테스트의 직접 대입, 향후 순간이동류
효과 등) 다음 진입 시점에 스스로 교정된다. `tickMonsters()` 안에서는 그
이후 `moveMonster` 호출마다 증분 갱신이 이어받아, 같은 틱 안에서 "먼저
처리된 몬스터는 최신 위치, 아직 처리 안 된 몬스터는 틱 시작 위치"라는
기존(그리드 도입 전) 순서 의존적 동작을 그대로 보존한다.

### 2.4 develop 병합 충돌 — 팀원의 보스/콜로니 작업과 동시에 진행됨

작업 도중 팀원이 보스 근접 패턴·콜로니 수호대 시스템을 두 차례 푸시해서
`world.ts`에서 총 5곳 충돌이 났다. 예: 팀원이 4곳에 흩어져 있던
`this.monsters.clear()`를 `clearAllMonsters()` 헬퍼(콜로니 수호대 장부까지
정리)로 통합해뒀길래, 그리드 clear도 각 호출부에 중복시키지 않고 그
헬퍼 안에 한 번만 넣도록 정리했다. `addMonster`가 `void`→`string`(생성한
id 반환)으로 시그니처가 바뀐 것도 같이 반영.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 26 files, 412 tests 전부 통과(신규 8개, spatialGrid.test.ts)
pnpm --filter @dropfall/server typecheck
pnpm --filter @dropfall/server test        # 31 tests 통과
pnpm --filter @dropfall/client typecheck
pnpm lint
```

## 4. 다음 작업

- 자원 노드/콜로니 대상 `isBlockedForMonster`/`findNearestObstacleCenter`는
  여전히 전체 순회다(O(자원노드+콜로니) — 개체 수가 몬스터만큼 크지 않아
  이번엔 손대지 않았다). 자원 노드가 크게 늘어나면 같은 방식으로 격자화할
  여지가 있다.
- 네트워크 전송(대역폭) 쪽 원인은 별도([backend/47](47-work-report-patch-rate-bandwidth.md)).
