# 66. 작업 보고서 — 웨이브 스폰 주기·방향을 인원수 스케일링에 맞춰 재조정

## 기획

사용자 피드백(원문):

> 몬스터 숫자만 늘어났지 코어공격하는 주기가 너무느리고한방향에 몰려오는 주기가
> 너무 느려 사방에서 동시에 공격하는 느낌으로 바꿔줘

`docs/backend/63-work-report-wave-player-scaling.md`(게임 흐름 피드백 #2)에서
`waves.json`의 잡몹 **총원**을 인원수 스케일링(`baseMultiplier=3, base=0.6,
perPlayer=2`)으로 크게 늘렸는데, 그 총원을 실제로 내보내는 **속도**(무리 크기
`groupSize`, 무리 간격 `groupIntervalSeconds`, 스폰 지점 수 `spawnPoints`)는 그대로
뒀다 — 총원만 커지고 배출 속도는 그대로니, 밤을 다 비우는 데 걸리는 시간이 그만큼
늘어나 "느려졌다"고 체감된 것이다. 거기에 스폰 지점 순환 방식 자체가 "무리 하나 =
지점 한 곳"이라, 다음 지점으로 넘어가려면 다음 무리(=groupIntervalSeconds 후)까지
기다려야 했다 — 그래서 한 번에 한 방향에서만 오는 것처럼 느껴졌다.

## 과정

### 1. `groupSize`도 총원과 같은 배율로 스케일링

`WaveManager.beginNextWave()`에서 `scaledSpawnCount()`(피드백 #2에서 이미 만든
함수, `waves.json`의 `playerScaling`을 그대로 적용)를 `entry.groupSize`에도 적용해
`this.groupSize`로 저장한다. 총원과 무리 크기가 같은 배율로 늘어나므로, **밤을
비우는 데 필요한 "무리 횟수"는 스케일링 전과 거의 같게 유지**되면서 무리 하나당
쏟아지는 마릿수만 인원수만큼 커진다 — 소요 시간(체감 페이싱)은 스케일링 이전과
비슷하게 유지하면서, 순간 압박은 인원수에 비례해 커지는 설계다.

### 2. 무리 하나를 스폰 지점 "전체"에 동시에 분산

기존엔 `spawnPointCursor`가 무리 단위로 지점을 하나씩 순환했다(무리1→지점A,
무리2→지점B, …). 이제 무리 하나(`this.groupSize`마리)를 **같은 틱 안에서**
`spawnPoints` 전체에 순서대로 나눠 심는다:

```ts
for (let i = 0; i < this.groupSize; i += 1) {
  const type = this.spawnQueue.shift();
  if (!type) break;
  const point = this.spawnPoints[(this.spawnPointCursor + i) % pointCount] ?? { x: 0, y: 0 };
  spawn(type, point.x, point.y);
}
this.spawnPointCursor += this.groupSize;
```

`spawnPointCursor`는 이제 "무리 간 순환"이 아니라 "무리 하나 안에서 나머지가 항상
같은 지점에 몰리지 않도록" 시작 지점을 매번 밀어주는 역할로 바뀌었다(예:
`groupSize`가 `pointCount`로 안 나눠떨어지면 나머지 1~2마리가 매번 다른 지점에
가도록).

### 3. `spawnPoints` 자체도 상향

무리를 전체 지점에 동시에 뿌려도, 애초에 지점 수가 적으면(1웨이브는 1곳) "사방"이
안 된다. `waves.json`의 `spawnPoints`를 웨이브별로 `1→4`, `2→4`, `2→5`, `3→6`,
`3→6`으로 올려서, 1웨이브부터 최소 4방향(동서남북) 이상에서 동시에 위협이 오도록
했다.

### 4. 테스트 갱신

`wave.test.ts`가 옛 설계("무리 하나 = 지점 한 곳")를 정확히 검증하고 있었다 —
이번 변경의 의도와 정반대라 그대로 깨졌다:

- `baseTotal`/`maxTotal` 옆에 `scaledGroupSize(entry, playerCount)` 헬퍼를 추가해
  (같은 `playerScaling` 공식을 독립적으로 재구현) 테스트가 스케일링된 무리 크기를
  직접 계산해서 검증하도록 했다.
- "한 무리는 같은 스폰 지점에서 함께 나오고" → "한 무리는 spawnPoints 전체에
  동시에 나눠 심고"로 테스트명·단언 변경(`new Set(...).size`가 `1`이 아니라
  `wave1.spawnPoints`여야 함).
- "스폰 지점을 무리 단위로 순환해서 한 지점에 몰리지 않는다" 테스트는 로직상
  그대로 통과했지만(지점 간 스폰 수 편차가 여전히 작게 유지됨), 이름·주석을
  새 설계에 맞게 갱신하고 편차 허용치를 `scaledGroupSize`로 교체했다.

## 결과

- `packages/shared/src/data/waves.json`: `spawnPoints`를 웨이브별로 4/4/5/6/6으로
  상향.
- `packages/shared/src/sim/wave.ts`: `groupSize` 인원수 스케일링 추가, 무리
  스폰을 지점 순환 → 지점 전체 동시 분산으로 교체.
- `packages/shared/tests/wave.test.ts`: 새 설계에 맞게 3개 테스트 갱신.
- 재검증: shared 전체 560/560(신규 revive-system 테스트 파일 포함), server
  typecheck·test(31) 전부 통과, lint 클린. **client typecheck는 기존에 있던
  무관한 에러**(`SnapshotInterpolator.ts`의 `waveMonsterBonus` 누락, 이번 변경
  전 HEAD에서도 재현됨 — `git stash`로 확인)라 손대지 않았다(클라이언트 담당
  영역).

이제 같은 인원수 스케일링 총원이라도, 밤이 시작되면 처음부터 여러 방향에서 동시에
몬스터 무리가 몰려오고, 그 파도가 스케일링 이전과 비슷한 리듬(무리 횟수 기준)으로
반복된다 — "숫자만 늘고 느려졌다"는 지적을 총원 대비 배출 속도를 맞추는 방식으로
해결했다.
