# 작업 보고서 — 스냅샷 보간(Snapshot Interpolation)으로 20Hz 렌더링 끊김 보강

> 서버 틱(과 로컬 시뮬 틱) 20Hz는 그대로 유지하면서, 60fps로 그리는 화면에서 캐릭터가
> 뚝뚝 끊겨 보이는 문제를 보강했다.

---

## 1. 기획 — 무엇을, 왜

지금까지 클라이언트는 `GameConnection.getSnapshot()`이 반환하는 "서버(또는 로컬 시뮬)가
마지막으로 알려준 상태"를 매 프레임(60fps) 그대로 그렸다. 그런데 상태 자체는 20Hz
(`TICK_RATE`)로만 갱신되므로, 같은 좌표를 ~3프레임 반복해서 그리다가 한 번에 툭 튀는
식으로 보였다 — "20Hz 유지 + 화면 안 끊기게"라는 요구는 상태 갱신 주기를 올리지 않고
**렌더링 쪽에서 그 간격을 메우는 방법**으로 풀어야 한다.

기술명세([02-tech-spec.md](../02-tech-spec.md) §4.2)는 이 문제를 원래 두 갈래로 나눠서
정의해 뒀다.

- 다른 플레이어/몬스터/투사체: **100ms 지연 버퍼 + 두 스냅샷 사이 선형 보간**
- 자기 캐릭터: **로컬 예측 + 서버 확정 시 재조정(reconciliation)** — 지연 없이 반응해야 함

이번 작업은 이 중 **보간만** 구현했다. 예측+재조정은 입력 히스토리 버퍼링과 재시뮬레이션
로직이 필요한 별도의 큰 작업이라 범위에서 뺐고, 그 결과 지금은 **본인 캐릭터도 다른
플레이어와 동일하게 100ms 지연 보간을 적용**한다 — 끊김은 없어지지만 본인 캐릭터도
입력 대비 ~100ms 느리게 반영된다. 이 트레이드오프는 실제로 플레이해보고 거슬리면 다음
작업(예측+재조정)으로 넘어가기로 했다.

또한 `LocalConnection`(`?local=1`, 서버 없이 브라우저에서 `shared/sim`을 그대로 돌리는
모드)도 내부적으로 `World.tick()`을 동일하게 20Hz로 돌리고 있어서 **똑같은 끊김 문제를
겪는다**는 걸 확인하고, 두 연결 방식이 같은 보간 로직을 재사용하도록 설계했다.

---

## 2. 과정 — 어떻게 했나

### 2.1 `packages/shared/src/sim/movement.ts` (신규)

`world.ts`에 있던 `PLAYER_SPEED`, clamp+대각선 정규화, 위치 적분 로직을 순수 함수로
뽑아냈다. 서버 권위 이동과 클라이언트(현재는 `InputController`, 나중엔 예측 로직)가
**항상 같은 코드**로 움직이게 하기 위해서다 — 실제로 `InputController.ts`에는 예전부터
"클라이언트 예측을 붙였을 때 같은 값을 써야 하므로 여기서도 맞춘다"는 주석과 함께 같은
정규화 로직이 중복돼 있었는데, 이번에 그 주석대로 정리했다.

```ts
export const PLAYER_SPEED = 100;
export function normalizeMoveVector(moveX: number, moveY: number): { moveX: number; moveY: number };
export function stepPosition(x, y, moveX, moveY, dtSeconds): { x: number; y: number };
```

`world.ts`와 `InputController.ts` 둘 다 이 함수를 쓰도록 교체했다.

### 2.2 `packages/client/src/net/SnapshotInterpolator.ts` (신규)

보강의 핵심. 새 상태가 들어올 때마다(`push`) 타임스탬프와 함께 버퍼에 쌓아두고, 매
렌더 프레임(`sample`)마다 "지금보다 100ms 전" 시점을 버퍼 안 두 스냅샷 사이에서 선형
보간해 반환한다.

- 위치(x, y)는 단순 lerp
- 조준각(aimAngle)은 최단 경로로 도는 `lerpAngle` — 그냥 lerp하면 -π/π 경계에서
  반대 방향으로 크게 돌아버린다
- 버퍼가 비었거나 범위를 벗어나면(막 연결/재접속 직후 등) 가장 가까운 값을 그대로 반환
- 오래된 스냅샷(1초 이상)은 버려서 재접속 등으로 버퍼가 무한정 쌓이는 걸 막는다

전송 방식(서버/로컬)에 종속되지 않는 순수 클라이언트 렌더링 유틸이라
`packages/client/src/net/`에 뒀다(서버에서도 도는 `shared/sim`과는 다른 계층).

### 2.3 연결부 — `ColyseusConnection.ts` / `LocalConnection.ts`

- `ColyseusConnection`: `room.onStateChange` 콜백(서버 패치가 올 때마다, 20Hz)에서
  `interpolator.push(...)`, `getSnapshot()`은 `interpolator.sample()`을 반환하도록 교체
- `LocalConnection`: `World.tick()`을 돌리는 20Hz `setInterval` 콜백 안에서 동일하게
  `interpolator.push(...)` 호출

`GameConnection` 인터페이스(`getSnapshot(): WorldSnapshot`)는 그대로 뒀다 — 보간은 연결
구현체 내부 디테일이라 `GameScene`/`EntityRenderer`는 코드 변경이 필요 없었다.

### 2.4 테스트

`packages/shared/tests/movement.test.ts` 신규 — clamp, 대각선 정규화, 위치 적분 검증
(5개). `SnapshotInterpolator`는 `packages/client`에 테스트 러너(vitest)가 아직 없어서
자동화 테스트는 못 붙였다 — typecheck/lint/build 통과와 코드 리뷰로 대신 검증했다.

---

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test   # 31 passed (기존 25 + movement 5 + 기존 world 1건 리팩터 반영)
pnpm typecheck                        # client/server 전체 통과
pnpm lint                             # 에러 0
pnpm build                            # client(vite)/server(tsup) 전체 통과
```

전부 통과. 실제 브라우저 두 개로 동시 접속했을 때 다른 플레이어가 부드럽게 움직이는지는
`pnpm dev`로 직접 확인해야 한다(자동화 테스트 범위 밖).

---

## 4. 다음 작업

- **자기 캐릭터 예측 + 재조정**(기술명세 §4.2 나머지 절반). 지금은 본인 캐릭터도 지연
  보간이라 입력 반응이 느리다 — 플레이테스트해보고 거슬리면 우선순위를 올린다.
  구현하게 되면 `movement.ts`의 `normalizeMoveVector`/`stepPosition`을 그대로 재사용해서
  서버와 클라이언트 예측이 어긋나지 않게 해야 한다.
- 몬스터/투사체가 붙으면([backend/11](11-mvp-scope-proposal-combat-wave.md)) 같은
  `SnapshotInterpolator`를 그대로 재사용할 수 있어야 한다 — `WorldSnapshot.players`
  구조만 보고 있어서, 몬스터도 같은 `{id, x, y, aimAngle}` 모양이면 그대로 확장 가능.

---

## 5. 후속 조정 — 지연 100ms → 50ms

플레이테스트 후 본인 캐릭터 입력 지연이 거슬린다는 피드백으로
`SnapshotInterpolator`의 `INTERP_DELAY_MS`를 100 → 50으로 낮췄다
([SnapshotInterpolator.ts](../../packages/client/src/net/SnapshotInterpolator.ts)).

**트레이드오프**: 50ms는 서버 틱 간격(20Hz = 50ms)과 정확히 같다. 즉 보간 버퍼가 스냅샷
두 개 사이를 딱 채우는 수준이라, 네트워크 지터로 다음 스냅샷이 조금만 늦게 도착해도
보간할 "미래" 스냅샷이 없어서 마지막 값에 스냅(정지)되는 구간이 100ms일 때보다 자주
생길 수 있다. 로컬/저지연 환경에서는 체감상 문제없었지만, 실제 배포 환경(홈서버 +
Cloudflare Tunnel, [기술명세 §9.3](../02-tech-spec.md))처럼 지연·지터가 있는 조건에서
다시 끊김이 두드러지면 이 값을 다시 올리는 것부터 확인해야 한다.

`pnpm --filter @dropfall/client run typecheck` / `pnpm lint` 재확인 통과. 값만 바뀐
변경이라 별도 테스트 추가는 하지 않았다.
