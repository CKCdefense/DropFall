# 작업 보고서 — 오브젝트 "잔상" 제거(+파괴된 콜로니 충돌 해제) + 건설모드 철거 기능

> 두 요청을 이어서 처리했다: (1) 자원 노드 고갈/콜로니 파괴 시 반투명하게
> 남기던 "잔상" 효과 제거 — 자원 노드는 이제 리스폰 위치가 바뀌어 필요
> 없어졌고, 콜로니는 사용자가 "랜드마크로 남긴다"던 예전 방침을 뒤집었다.
> 그 과정에서 파괴된 콜로니가 여전히 하드 충돌로 막고 있던 것도 같이
> 고쳤다. (2) 건설모드(B로 순환)에 철거(demolish) 기능 추가 — 환급 없음.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "오브젝트 잔상남는효과는 없애줄래? 이제 필요없을거같고" +
"건설모드에 철거기능도 추가하자". "잔상"이 정확히 뭔지 물었더니: "나무나
돌을 다캤을 때 희미하게 보이는것 추가로 제거된 콜로니도 같은 효과가 있고
아직 희미한 콜로니에 대한 충돌 제거가 없어 해당부분도 수정해야함". 철거
환급 여부는 "환급 없음"으로 확정.

두 대상 다 반투명(`setAlpha`)으로 "아직 있지만 못 쓴다"를 표시하고 있었다
(`EntityRenderer.ts`) — 자원 노드는 `node.hp > 0 ? 1 : 0.3`, 콜로니는
`colony.destroyed ? COLONY_DESTROYED_ALPHA(0.25) : 1`. 처리 방식을 반투명
대신 **완전히 숨김**(`setVisible`)으로 정했다: 자원 노드는 docs/backend/39로
리스폰이 같은 자리가 아니라 군집 안 새 위치로 바뀌면서 옛 자리에 흐린
잔상을 남길 이유가 사라졌고, 콜로니는 사용자가 명시적으로 "같은 효과를
없애 달라"고 했으니(colony.ts의 "랜드마크로 남긴다"던 원래 의도를 이번에
뒤집는 것으로 처리).

## 2. 과정 — 어떻게 했나

### 2.1 잔상 제거

`EntityRenderer.ts` 두 곳: `syncResourceNodes()`의
`sprite.setAlpha(node.hp > 0 ? 1 : 0.3)` → `sprite.setVisible(node.hp > 0)`,
`syncColonies()`의 `sprite.setAlpha(colony.destroyed ? COLONY_DESTROYED_ALPHA : 1)`
→ `sprite.setVisible(!colony.destroyed)`. 더 안 쓰는 `COLONY_DESTROYED_ALPHA`
상수는 삭제.

### 2.2 파괴된 콜로니 하드 충돌 해제

지금까지는 파괴된 콜로니도 "폐허"로 계속 막고 있었다(docs/backend/38의
의도적 설계, `isBlockedForPlayer`/`isBlockedForMonster`/
`projectileHitsObstacle`가 `colony.destroyed`를 안 봤다) — 이번에 뒤집었다.
네 곳(위 세 곳 + `findNearestObstacleCenter`, 몬스터 접선 미끄러짐이 참조하는
"가장 가까운 장애물" 탐색)에 자원 노드의 `if (node.hp <= 0) continue;`와
같은 패턴으로 `if (colony.destroyed) continue;`를 추가했다.

**FlowField 셀도 같이 갱신해야 했다.** `colonyObstacleCells`는
`startColonies()` 시점에 한 번만 채우고 다시 안 건드리는 캐시였다(콜로니는
위치가 절대 안 바뀐다는 전제였지 "존재 여부"가 바뀔 거라곤 설계에 없었다).
신규 `rebuildColonyObstacleCells()`(자원 노드의 `rebuildResourceObstacleCells()`와
같은 패턴 — 파괴 안 된 콜로니만 셀에 등록)를 만들어 `startColonies()`가
쓰게 바꾸고, 콜로니가 파괴되는 순간(`tickChannels()`, `colonies.destroy()`
직후)에도 호출해서 그 즉시 반영되게 했다.

### 2.3 철거 기능

기존 건축 흐름(`BuildInputMessage` → `World.placeBuilding` →
`BuildingRegistry.place/remove`)을 그대로 따라갔다 — `BuildingRegistry.remove(id)`가
이미 있어서(몬스터가 건축물을 부술 때 쓰던 것) 재사용하면 됐다.

- 프로토콜: `DemolishInputMessage { cx, cy }` 신규.
- 서버: `World.demolishBuilding(playerId, cx, cy)` — 타입 검증 → 플레이어
  존재 확인 → `buildings.at(cx, cy)`로 대상을 찾아 없으면 조용히 무시 →
  `buildings.remove(id)` + `recomputeFlowField()`. 자원 환급 없음. 코어
  건설 반경 검사는 안 한다(이미 지어진 건축물은 그 시점에 이미 반경 안이었고,
  반경은 코어 티어가 오를수록만 넓어지므로 항상 유효하다).
- `GameRoom`에 `demolishBuilding` 메시지 핸들러, `GameConnection`/
  `LocalConnection`/`ColyseusConnection`에 대응 메서드 추가.
- `InputController.ts`: `BUILD_MODES`에 `'demolish'` 추가(`off → fence → wall →
  demolish → off` 순환). `demolish` 모드에서 좌클릭은 `placeBuilding` 대신
  `demolishBuilding`을 부르도록 분기.
- `HudScene.ts`: `BUILD_MODE_LABEL`에 `demolish: '철거'` 추가. 건설모드 힌트
  문구도 "좌클릭 설치"가 철거 모드에는 안 맞아서 `demolish`일 때는
  "좌클릭 철거(환급 없음)"로 갈랐다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 18 files, 285 tests 전부 통과(신규 7개)
pnpm --filter @dropfall/server typecheck   # 순차 실행(동시 -r 실행 시 이 환경 OOM)
pnpm --filter @dropfall/client typecheck
pnpm lint      # 에러 0
pnpm build     # client(vite)/server(tsup) 전체 통과
```

신규 테스트 7개(`world-building.test.ts`):
- 철거: 건축물이 사라지고 그 칸에 재배치 가능한지, 자원이 안 늘어나는지
  (환급 없음), 빈 칸/존재하지 않는 플레이어·비정상 좌표는 조용히 무시하는지.
- 파괴된 콜로니: 플레이어/투사체가 더 이상 막히지 않는지, 코어로 걸어가는
  몬스터가 더 이상 우회하지 않고 그냥 통과하는지(FlowField 셀 갱신 검증 —
  `colony.destroyed`를 직접 조작하지 않고 실제 채널링 경로를 그대로 태워서
  캐시 갱신 여부까지 확인했다).

## 4. 다음 작업

- **철거에 시각 피드백이 없다** — 지금은 즉시 사라지기만 한다. 파괴 이펙트
  (fx_collapse 등 최근 추가된 FX 에셋)를 재사용할 수 있을지는 역할 C 몫이라
  이번 범위 밖으로 남긴다.
- **콜로니가 파괴되면 화면에서 완전히 사라진다** — "여기 콜로니가 있었다"는
  기록이 미니맵/HUD 어디에도 안 남는다. 필요해지면 별도로 다룬다.
