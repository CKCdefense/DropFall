# 작업 보고서 — PATCH_RATE 60→20Hz, 2인 이상 실접속 렉의 진짜 원인

> 몬스터 공간 분할 격자([backend/45](45-work-report-monster-spatial-grid.md))로
> 시뮬레이션 쪽 O(n²)를 잡았는데도 "2명 이상이 서버에 접속해서 플레이하면
> 렉이 심하다"는 제보가 이어졌다. 원인은 CPU가 아니라 **네트워크 전송** —
> `PATCH_RATE`(상태 전송 주기)가 틱과 같은 60Hz라, 대역폭이 접속 인원수에
> 그대로 곱해지고 있었다.

---

## 1. 기획 — 무엇을, 왜

원문 요청: "아직도 2명이상의 플레이어가 서버에 접속해서 플레이 하려고하면
렉이 심하게 발생하는데 어떻게 더 최적화 할 수 있을까?" — 몬스터/투사체
스케일링 문제([backend/45](45-work-report-monster-spatial-grid.md))를 이미
고친 뒤에도 남아 있는 증상이라, 원인이 다른 곳(네트워크)이라고 보고
조사했다.

## 2. 과정 — 어떻게 했나

### 2.1 시뮬레이션 쪽을 먼저 배제

`world.ts` 전체에서 남아있는 O(n²)급 순회를 다시 훑었다 — 콜로니 수호대
소환(`tickColonyGuards`, O(콜로니×플레이어) ≤ 16), Flow Field 재계산
호출부(`recomputeFlowField`) 전부(건축/철거/자원고갈 등 이벤트 기반, 매
틱이 아님) 등을 확인했지만 전부 인원수 2명 남짓에서 체감될 만큼 무겁지
않았다. 즉 CPU 시뮬레이션 쪽은 용의선상에서 벗어났다.

### 2.2 `PATCH_RATE`가 접속 인원수만큼 곱해지는 구조

`packages/shared/src/constants.ts`에 이미 힌트가 있었다:

```ts
// 지금은 틱과 같게 두지만, 대역폭이 문제가 되면 이 값만 낮추면 된다
// (틱은 그대로 두고 전송만 줄이는 것이 일반적인 최적화다).
export const PATCH_RATE = TICK_RATE; // 60
```

그리고 `docs/frontend/05-work-report-patch-rate.md`(PATCH_RATE를 원래
도입한 작업 보고서) 끝에도: "60Hz 전송의 실제 대역폭은 아직 측정하지
않았다. 4인 룸 기준으로는 문제없어 보이지만, 엔티티가 늘어나면 다시 볼
것." — 정확히 지금 상황을 미리 예견해 둔 메모였다.

Colyseus의 `Room.patchRate`는 **클라이언트 소켓마다 독립적으로** 상태
패치를 내보낸다. 즉 서버가 초당 60번 계산한 상태를 접속한 클라이언트
각각에게 초당 60번씩 따로 인코딩·전송한다 — 1명이면 X만큼의 업로드가
필요하고, 2명이면 그대로 2X다. 홈서버(Tailscale Funnel 경유,
[backend/45 배포 작업] 참고)의 업로드 대역폭이 넉넉하지 않으면, 딱 2인
접속부터 밀리기 시작하는 게 CPU가 아니라 이 구조 때문이다.

### 2.3 수정 — 틱은 그대로, 전송만 낮춘다

`PATCH_RATE`를 60 → **20**으로 낮췄다. `TICK_RATE`(시뮬레이션 정밀도)는
그대로 60을 유지한다.

클라이언트의 `SnapshotInterpolator`는 이미 보간 지연을 **틱이 아니라
`PATCH_RATE` 기준**으로 계산하도록 설계돼 있었다(`docs/frontend/05`가
남긴 재발 방지 조치) —

```ts
const INTERP_DELAY_MS = (INTERP_DELAY_PATCHES * 1000) / PATCH_RATE;
```

— 그래서 이 상수 하나만 바꾸면 클라이언트가 자동으로 지연을 33ms →
100ms로 늘려 잡고 그만큼 더 부드럽게 재생한다. 코드 두 군데
(`GameRoom.patchRate`, `SnapshotInterpolator`) 모두 이 상수를 그대로
가져다 쓰는 구조라 수정은 상수 하나로 끝났다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test        # 26 files, 427 tests 전부 통과
pnpm --filter @dropfall/server typecheck
pnpm --filter @dropfall/server test        # 31 tests 통과
pnpm --filter @dropfall/client typecheck
pnpm lint
```

실제 대역폭 절감 효과(3배)나 100ms 보간 지연의 체감은 코드 레벨에서
확인할 수 없다 — 실제 2인 이상 접속 플레이테스트로 확인이 필요하다.

## 4. 다음 작업

- 실제 다인 플레이테스트에서 여전히 끊기면 `PATCH_RATE`를 더 낮추거나
  (예: 15), 반대로 100ms 지연이 체감상 너무 굼뜨면 다시 올리는 미세
  조정이 필요할 수 있다 — 이 상수 하나로 조절 가능하다.
- `LocalConnection`(오프라인 모드)은 네트워크가 없어 이 문제와 무관하지만,
  스냅샷을 여전히 `TICK_RATE`(60Hz)로 밀어 넣고 있다 — `SnapshotInterpolator`가
  이제 `PATCH_RATE`(20Hz) 기준으로 지연을 더 길게 잡으므로 오프라인 모드는
  실제 필요보다 약간 더 보수적인(불필요하게 긴) 지연을 갖게 됐다. 깨진 건
  아니지만, 오프라인 모드 전용 미세 최적화 여지로 남겨둔다.
- `docs/frontend/05`가 미리 남긴 "엔티티가 늘어나면 AOI와 함께 다시
  볼 것"은 아직 유효한 다음 단계다 — 참가자 관심 영역(Area of Interest)
  필터링으로 각 클라이언트에게 안 보이는 개체는 아예 안 보내는 방식은
  이번 수정(전송 주기 낮추기)과 별개로, 맵/개체 수가 더 커지면 검토할
  가치가 있다.
