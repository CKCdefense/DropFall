# 작업 보고서 — 서버 틱레이트 20Hz → 60Hz 상향

> [backend/12](12-work-report-snapshot-interpolation.md)에서 스냅샷 보간을 붙였더니 화면은
> 부드러워졌는데, 본인 캐릭터의 입력 반응이 느려졌다는 피드백이 나왔다. 보간 지연 값만
> 조정해서는 반응성 자체를 못 고친다는 판단하에, 근본 원인인 `TICK_RATE`를 실제 배포
> 서버 사양에 맞춰 재검토했다.

---

## 1. 기획 — 무엇을, 왜

### 1.1 문제 진단

`SnapshotInterpolator`(backend/12)는 20Hz로만 갱신되는 상태를 60fps 화면에 부드럽게
보여주려고 100ms → 50ms 지연 보간을 적용했다. 그런데 보간 지연 값을 아무리 낮춰도
**반응성의 진짜 하한선은 `TICK_RATE` 자체**다 — 입력이 실제로 처리되고 상태에 반영되는
단위가 20Hz(50ms)면, 클라이언트 버퍼를 아무리 짧게 잡아도 그 이하로는 못 내려간다.

즉 지금까지의 보간 튜닝은 "부드러움 ↔ 반응성"이라는 같은 예산 안에서 값을 옮긴 것뿐이고,
근본적으로 예산 자체(틱레이트)를 늘려야 둘 다 개선된다.

### 1.2 서버 사양 확인

사용자가 실제 배포용 홈서버 사양을 제공했다.

| 항목 | 값 |
|---|---|
| OS | Ubuntu 26.04 LTS, Proxmox VM |
| CPU | 6 코어 |
| 메모리 | 11 GiB (여유 10 GiB) |
| 디스크 | 128GB 여유 |
| 접속 | Tailscale SSH |

[기술명세 §9.1](../02-tech-spec.md)에 이미 "20Hz 틱 4인 룸은 라즈베리파이급으로도 충분"이라고
적혀 있을 만큼 연산량 자체가 가벼운데, 이 정도 사양이면 60Hz(4인 룸 기준 틱당 16.67ms 예산)도
CPU 여유가 압도적이라고 판단했다.

### 1.3 결정: 60Hz로 상향

`TICK_RATE`는 [기술명세 §4.1](../02-tech-spec.md#41-기본-설계)과
[backend/05 §5](05-backend-demo-plan.md)에 "확정 후 변경 시 전원에게 공지"라고 못박힌
잠금 상수라, 사용자에게 먼저 확인을 받았다 — ① 60Hz 상향 ② 클라이언트 자기 예측만 구현
③ 둘 다, 세 옵션 중 **① 60Hz 상향**을 선택받았다. 클라 렌더(60fps)와 서버 틱을 1:1로
맞추는 값이라 근거도 명확했다.

---

## 2. 과정 — 어떻게 했나

### 2.1 `packages/shared/src/constants.ts`

`TICK_RATE = 20` → `60`. `INPUT_SEND_RATE`가 `TICK_RATE`에서 파생되는 값이라(`= TICK_RATE`)
자동으로 같이 올라간다. 왜 60인지, 왜 이게 팀 잠금 상수인지 주석으로 남겼다.

### 2.2 `packages/client/src/net/SnapshotInterpolator.ts`

`INTERP_DELAY_MS`를 하드코딩된 `50`이 아니라 `(INTERP_DELAY_TICKS * 1000) / TICK_RATE`
(2틱 여유)로 바꿨다. `TICK_RATE`를 또 바꾸게 되더라도 이 파일을 다시 튜닝할 필요가 없게
하기 위해서다. 60Hz 기준 `INTERP_DELAY_MS ≈ 33.3ms`로, 기존 50ms보다 짧아졌다 — 절대
지연이 줄고, 왜 2틱을 유지하는지(지터 여유) 주석에 남겼다.

### 2.3 코드에 남아있던 "20Hz" 하드코딩 표현 정리

로직 자체(`GameRoom.ts`, `LocalConnection.ts`의 `1000 / TICK_RATE` 계산)는 이미 상수
기반이라 코드 수정이 필요 없었다. 다만 주석/문서 여러 곳에 "20Hz"가 리터럴로 박혀 있어서
그대로 두면 오해를 부른다 — `InputController.ts`, `ColyseusConnection.ts`,
`LocalConnection.ts`의 주석을 "서버 틱(TICK_RATE)"처럼 상수 참조로 바꿨다.

### 2.4 문서 갱신

"지금 상태를 설명하는" 살아있는 참조 문서만 갱신했다(과거 작업 보고서는 그 시점 기록이라
그대로 둠):

- [02-tech-spec.md](../02-tech-spec.md) §3 다이어그램, §4.1 표, §8 성능 목표, §9.1,
  §4.3 대역폭 절감에 60Hz 반영 + 60Hz 기준 틱 예산(16.67ms)이 더 빠듯해졌다는 점,
  브로드캐스트 빈도가 3배 됐다는 점 명시
- [05-team-notes.md](../05-team-notes.md) §2 입력 전송 규칙
- [backend/05-backend-demo-plan.md](05-backend-demo-plan.md) §4 기술 결정 요약 —
  예측/보간 행도 "스펙은 예측+보간이지만 현재 구현은 예측 없이 전원 보간"으로 실제 구현
  상태와 맞춰 갱신
- [frontend/01-client-architecture.md](../frontend/01-client-architecture.md) §2.6, §5
- [frontend/02-lobby-room-protocol.md](../frontend/02-lobby-room-protocol.md) §3

---

## 3. 결과 — 검증

```bash
pnpm typecheck                        # client/server 전체 통과
pnpm --filter @dropfall/shared test   # 31 passed
pnpm lint                             # 에러 0
pnpm build                            # client(vite)/server(tsup) 전체 통과
```

전부 통과. 실제 서버로 스모크 테스트(`pnpm --filter @dropfall/server smoke`)를 돌리려
했으나, 마침 사용자가 브라우저로 접속해 테스트 중인 방("hosup", 비밀번호 있음)이 떠 있어서
`joinOrCreate`가 그 방에 비밀번호 없이 join하려다 거부됐다 — 코드 문제가 아니라 테스트
스크립트가 기존 방과 충돌한 것이라 사용자의 세션을 방해하지 않도록 그대로 뒀다. 스모크
테스트의 단언(assertion)들은 절대 좌표값이 아니라 상대 비교(`x > 0`, `x === xAfterStop`
등)만 쓰고 있어서 틱레이트 변경과 무관하게 통과할 것으로 판단했다.

---

## 4. 다음 작업

- **자기 캐릭터 예측 + 재조정**은 여전히 미착수. 60Hz로 절대 지연은 줄였지만
  ([backend/12](12-work-report-snapshot-interpolation.md) §5 참고), 본인 캐릭터도 남과
  동일하게 보간되는 구조는 그대로다. 플레이테스트해서 여전히 거슬리면 이 작업을 시작한다.
- 배포([backend/05](05-backend-demo-plan.md) D8-9) 이후 실제 홈서버에서 4인 접속 시
  틱 처리 시간을 프로파일링해서 60Hz에서도 여유가 있는지 실측 확인이 필요하다
  (지금은 로컬 개발 환경 기준 판단만 했다).
- 몬스터/투사체가 붙으면([backend/11](11-mvp-scope-proposal-combat-wave.md)) 틱당 연산량이
  늘어나므로, §8 성능 목표(< 10ms/tick)를 다시 프로파일링할 것.
