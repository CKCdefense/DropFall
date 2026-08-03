# 작업 보고서 — 보간 버퍼 부족 시 외삽(dead reckoning) 추가

> [backend/12](12-work-report-snapshot-interpolation.md)로 보간을 붙이고
> [backend/13](13-work-report-tick-rate-60hz.md)로 틱레이트를 60Hz로 올린 뒤에도, 사용자가
> 실제로 플레이해보니 "보간이 들어간 것치고 여전히 끊겨 보인다"는 문제를 신고해서 원인을
> 진단하고 고쳤다.

---

## 1. 기획 — 무엇을, 왜

### 1.1 원인 진단

`SnapshotInterpolator`의 지연 마진(`INTERP_DELAY_MS`)은 2틱, 60Hz 기준 약 33ms다.
이 값은 "스냅샷 두 개 사이를 딱 채우는" 수준이라 여유가 거의 없다 — 네트워크 지터나
프레임 타이밍이 조금만 어긋나서 다음 스냅샷이 예정보다 늦게 도착하면, 기존 `findBracket`은
"보간할 미래 스냅샷이 없다"고 판단해 **마지막 값에 그대로 멈춰버렸다**
(`renderTime >= last.time`일 때 `{ from: last, to: last, t: 0 }` 반환). 이게 사용자가
본 끊김의 정체다.

### 1.2 왜 마진을 그냥 늘리지 않았나

지연 마진을 늘리면(예: 2틱 → 4틱) 이 문제는 줄어들지만, 그만큼 화면에 보이는 위치가 더
늦게 반영돼서 반응성이 다시 나빠진다 — [backend/13](13-work-report-tick-rate-60hz.md)에서
틱레이트를 60Hz로 올려서 확보한 반응성 개선을 도로 깎아먹는 셈이다. 대신 마진은 그대로
두고, **버퍼가 바닥났을 때만** 마지막 두 스냅샷의 속도로 잠깐 앞으로 밀어서 예측하는
외삽(dead reckoning)을 추가하는 쪽을 택했다 — 멀티플레이어 게임에서 이 문제를 다루는
표준적인 방법이다.

---

## 2. 과정 — 어떻게 했나

[SnapshotInterpolator.ts](../../packages/client/src/net/SnapshotInterpolator.ts) 수정.

- `sample()`에서 `renderTime`이 버퍼의 마지막 스냅샷 시각보다 미래면(버퍼 부족), 기존처럼
  `findBracket`으로 넘기지 않고 새 `extrapolate()` 경로로 분기한다.
- `extrapolate()`는 마지막 두 스냅샷(`last`, `prev`)에서 플레이어별 속도
  (`vx = (last.x - prev.x) / dt`)를 구하고, 부족한 시간(`overshootMs`)만큼 앞으로 밀어
  위치를 추정한다. `aimAngle`은 외삽하지 않고 마지막 값을 그대로 쓴다 — 조준각은 마우스로
  순간적으로 바뀌는 값이라 속도 기반 추정이 의미가 없다.
- `overshootMs`는 `MAX_EXTRAPOLATION_MS`(100ms)로 clamp한다. 재접속처럼 스냅샷이 아주
  오래 안 오는 상황까지 외삽하면 엉뚱한 방향으로 계속 튀어나갈 위험이 커지므로, 그 이상은
  그냥 마지막 위치에 고정한다.
- 이전 두 스냅샷을 못 구하거나(`buffer.length < 2`) 해당 플레이어가 이전 스냅샷에 없으면
  (막 등장한 플레이어) 속도를 알 수 없으므로 마지막 위치를 그대로 쓴다.
- `findBracket()`은 이제 "`renderTime < last.time`이 보장된 상태에서만 호출된다"는 전제가
  생겨서, 안쪽에 있던 동일한 버퍼-부족 분기(죽은 코드가 됨)를 제거하고 그 사실을 주석으로
  남겼다.

---

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/client run typecheck   # 통과
pnpm lint                                       # 에러 0
pnpm --filter @dropfall/shared test             # 31 passed (영향 없음, shared 코드 변경 없음)
pnpm build                                      # client(vite)/server(tsup) 전체 통과
```

전부 통과. `SnapshotInterpolator`는 `packages/client`에 테스트 러너가 없어서
([backend/12](12-work-report-snapshot-interpolation.md)와 동일한 제약) 자동화 테스트는
못 붙였고, 코드 리뷰 + typecheck/lint/build로 대신했다. 실제 지터 상황에서 끊김이
줄었는지는 `pnpm dev`로 직접 플레이해서 확인해야 한다.

---

## 4. 다음 작업

- 여전히 자기 캐릭터 예측+재조정은 미착수([backend/12](12-work-report-snapshot-interpolation.md) §4,
  [backend/13](13-work-report-tick-rate-60hz.md) §4). 외삽은 "다른 플레이어가 잠깐 멈추는
  문제"는 고치지만, 본인 캐릭터의 입력 지연 자체는 그대로다.
- `MAX_EXTRAPOLATION_MS`(100ms)는 임의값이다. 실제 홈서버 배포 환경(Cloudflare Tunnel
  경유)에서 지터가 이 값보다 자주 크면, 외삽이 자주 100ms 캡에 걸려 다시 멈춤이 보일 수
  있다 — 그때는 이 값을 실측 기반으로 다시 조정한다.
- 몬스터/투사체가 붙으면([backend/11](11-mvp-scope-proposal-combat-wave.md)) 같은
  외삽 로직을 그대로 재사용할 수 있어야 한다 — `WorldSnapshot.players` 구조에 의존하고
  있어서, 몬스터도 같은 `{id, x, y, aimAngle}` 모양이면 확장 가능하다.
