# 작업 보고서 — 몬스터가 남았는데 낮으로 바뀌는 버그 수정

> "몹이 전부 제거되지 않았는데 낮 phase로 바뀐다"는 제보를 받아 원인을 찾고 고쳤다.
> `WaveManager.tick()`이 "살아있는 몬스터 수"를 인자로 받는 방식 자체에 경합(race)이
> 있었다.

---

## 1. 기획 — 무엇을, 왜

`WaveManager.tick(dtSeconds, remainingMonsters, spawn)`은 스폰 큐가 비었고
(`spawnQueue.length === 0`) 살아있는 몬스터도 없으면(`remainingMonsters === 0`) 밤을
끝내고 낮으로 전환한다. 그런데 실제로는 아직 몬스터가 남아 있는데도 낮으로 바뀌는
현상이 보고됐다 — 코드를 다시 보니 `remainingMonsters`를 넘기는 방식 자체에 경합이
있었다.

## 2. 과정 — 어떻게 했나

### 2.1 원인 — 틱 시작 시점 스냅샷과 "이번 틱 스폰"의 경합

`World.tick()`의 호출부:

```ts
this.waveManager.tick(dtSeconds, this.monsters.size, (type, x, y) =>
  this.addMonster(type, x, y),
);
```

`this.monsters.size`는 **이 줄이 실행되는 순간(= `waveManager.tick()` 안의 스폰 루프가
돌기 전) 값으로 딱 한 번 평가**된다. 그런데 `WaveManager.tick()` 내부는 이렇게
생겼었다:

```ts
tick(dtSeconds, remainingMonsters, spawn) {
  // ... night 분기 ...
  while (this.spawnQueue.length > 0 && this.spawnTimer <= 0) {
    // spawn() 콜백으로 새 몬스터를 World.monsters에 추가
    spawn(type, point.x, point.y);
    ...
  }

  if (this.spawnQueue.length === 0 && remainingMonsters === 0) {
    // → day 전환
  }
}
```

이전에 스폰된 몬스터가 전부 죽어서 `remainingMonsters`가 0으로 넘어온 그 틱에, 마침
스폰 큐의 **마지막 몬스터**가 스폰될 차례였다면: 위 `while` 루프가 새 몬스터를
`World.monsters`에 추가해서 `spawnQueue.length`를 0으로 비우지만, 그 아래 `if`문이
보는 `remainingMonsters`는 **이 틱이 시작되기 전에 이미 박제된 값(0)**이라 방금 스폰된
몬스터를 전혀 모른다. 결과: 스폰 큐도 비었고(true) `remainingMonsters`도 0(true) →
방금 살아난 몬스터를 무시하고 그대로 day로 전환.

### 2.2 재현

`World` 내부 몬스터 맵을 직접 조작해서(스폰되는 즉시 죽는 상황을 흉내) 회귀를
확인했다: 매 틱 직후 몬스터를 전부 제거하면, 다음 틱에서 `remainingMonsters`가 항상
0인 상태로 들어가고, 그 틱에 마지막 스폰이 겹치면 실제로 "몬스터 1마리가 살아있는
채로 day 전환"이 재현됐다(수정 전 코드에서 tick 1049번째에 재현).

### 2.3 수정 — 값이 아니라 콜백으로

`remainingMonsters: number` 매개변수를 `getRemainingMonsters: () => number` 콜백으로
바꿨다. `if` 문에서 `getRemainingMonsters()`를 그 자리에서 호출하면, `while` 루프가
끝난 뒤(= 이번 틱의 스폰이 전부 반영된 뒤) 시점의 실제 마릿수를 본다.

```ts
if (this.spawnQueue.length === 0 && getRemainingMonsters() === 0) { ... }
```

`World.tick()` 쪽도 값 대신 게터를 넘기도록 바꿨다:

```ts
this.waveManager.tick(
  dtSeconds,
  () => this.monsters.size,
  (type, x, y) => this.addMonster(type, x, y),
);
```

`spawn` 콜백이 원래도 "World의 실시간 상태를 즉시 반영하는" 콜백이었던 것과 대칭이
맞다 — 이제 "살아있는 마릿수 조회"도 같은 방식(콜백)으로 통일됐다.

### 2.4 테스트

- `wave.test.ts`의 기존 호출부는 전부 `remainingMonsters` 자리에 숫자 리터럴/변수를
  직접 넘기고 있었는데, 시그니처가 바뀌면서 전부 `() => 값` 형태로 고쳐야 했다(총
  18곳). 대부분 `() => 0`으로 단순 대체했고, "스폰 진행 중 마릿수를 추적하던" 곳들은
  `() => spawnedCount` 처럼 그대로 라이브 콜백으로 바뀌어 오히려 더 정확해졌다.
- 회귀 테스트 1개 추가: 실제로 살아있는 마릿수를 추적하는 콜백을 넘겨서, 마지막
  몬스터가 스폰되는 바로 그 틱에도 `night`을 유지하는지 확인한다(고치기 전이었다면
  이 조건을 검증할 방법이 없었다 — 시그니처 자체가 콜백을 요구하지 않았으니까).

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test     # 89 passed (기존 88 + 신규 1)
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

수정 전 재현 스크립트(위 2.2)를 수정 후 다시 돌려서 더 이상 재현되지 않는 것도
확인했다.

전부 통과.

## 4. 다음 작업

- 없음. `spawn`/`getRemainingMonsters` 둘 다 "World의 실시간 상태를 즉시 반영하는
  콜백"으로 통일됐으니, 앞으로 `WaveManager`에 또 다른 "현재 상태 조회"가 필요해지면
  같은 패턴(값이 아니라 콜백)을 따르면 이번과 같은 종류의 경합을 피할 수 있다.
