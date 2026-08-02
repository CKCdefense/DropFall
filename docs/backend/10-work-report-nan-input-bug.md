# 작업 보고서 — NaN 오염 버그 수정 (`trying to encode "NaN" in PlayerSchema#x/y`)

> 사용자가 브라우저(Playground)에서 테스트하다가 서버 로그에 `trying to encode "NaN" in
> PlayerSchema#x` / `#y`가 무한 반복되는 걸 발견해서 신고. 원인 파악과 수정, 재현 검증까지 진행.

---

## 1. 기획 — 무엇을, 왜

로그만 보고도 원인을 특정할 수 있었다: `PlayerSchema#x/y`가 계속 `NaN`으로 인코딩 시도된다는
건 **`x` 또는 `y`가 이미 `NaN`으로 고정됐고, 그 상태에서 매 틱(20Hz) Colyseus가 상태를
브로드캐스트하려다 계속 실패**하고 있다는 뜻이다 (반복 빈도가 20Hz와 맞아떨어짐).

지금까지의 입력 검증([07번 문서](07-work-report-input-sync-hardening.md))은 `moveX`/`moveY`
값의 **범위**만 `-1~1`로 clamp했지, **타입**은 검증하지 않았다.

```ts
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
// clamp(undefined, -1, 1) === NaN
```

`input.moveX`가 `undefined`거나 숫자가 아니면 `clamp()`가 그대로 `NaN`을 반환하고,
`player.x += NaN`은 그 순간부터 **영원히 `NaN`으로 고정**된다 (NaN + 무엇을 더해도 NaN이라
한 번 오염되면 절대 복구가 안 됨). 재현 경로: Colyseus Playground의 "메시지 직접 보내기"
기능으로 `input` 메시지를 필드 누락 상태로 보내면 바로 발생한다 — 실제 게임 클라이언트가
아직 없어서 이런 손으로 만든 잘못된 메시지가 들어올 가능성이 평소보다 높은 상황이었다.

**참고**: 사용자가 브라우저 자동화 도구("chrome mcp")로 직접 재현해서 보여달라고 했는데,
이 세션에는 그런 도구가 연결돼 있지 않아서 사용할 수 없었다. 대신 로그 분석 + 코드 추론으로
원인을 특정하고, 서버 쪽 스모크 테스트 스크립트로 동일한 시나리오를 재현/검증했다.

---

## 2. 과정 — 어떻게 했나

### 2.1 수정 — [packages/shared/src/sim/world.ts](../../packages/shared/src/sim/world.ts)
`World.setInput()`에 타입 검증을 추가했다. `seq`/`moveX`/`moveY`/`aimAngle` 중 하나라도
숫자가 아니거나(`typeof !== 'number'`) `NaN`/`Infinity`면 **입력 전체를 무시**한다 (직전에
받았던 유효한 입력이 계속 유지됨 — 부분적으로 반영하지 않는다). `payload` 자체가
`undefined`/`null`인 경우도 방어했다 (안 그러면 `input.seq` 접근에서 바로 예외가 난다).

```ts
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
```

### 2.2 회귀 테스트 — [packages/shared/tests/world.test.ts](../../packages/shared/tests/world.test.ts)
- 필드 누락 입력 → 무시되고 `NaN`이 안 생김
- `NaN`이 명시적으로 담긴 입력 → 무시됨
- `undefined`/`null` payload → 예외 없이 무시됨
Vitest 8개 전부 통과 (기존 5개 + 신규 3개).

### 2.3 실제 네트워크로 재현 — [packages/server/src/dev/smoke-test.ts](../../packages/server/src/dev/smoke-test.ts)
[08번 문서](08-work-report-connection-smoke-test.md)의 스모크 테스트에 시나리오를 추가했다:
1. 정상 입력으로 이동 확인
2. 정지 입력(`moveX:0`)으로 위치를 고정
3. **필드 누락 메시지(`{}`)와 타입이 틀린 메시지(`moveX: 'not-a-number'`)를 실제로
   `room.send()`로 전송** — Playground에서 손으로 보내는 것과 동일한 경로
4. 위치가 그대로인지, `NaN`이 안 생겼는지 확인

처음엔 "위치가 완전히 그대로여야 한다"고 잘못 assert해서 테스트가 실패했는데(이전 정상 입력이
계속 유지되며 이동 중이었을 뿐, 버그 아님), 정지 입력을 먼저 보내 기준점을 만드는 방식으로
테스트를 고쳤다.

---

## 3. 결과 — 검증

```
$ pnpm --filter @dropfall/server run smoke
[smoke-test] joined room "AyfV6EypY" as "7iT5b5NbE"
[smoke-test] initial state: x=0 y=0
[smoke-test] after input+500ms: x=40 y=0 seq=1
[smoke-test] after stop input: x=50
[smoke-test] after malformed input: x=50 y=0
[smoke-test] OK — 연결, join, 입력 전송, 상태 동기화, 잘못된 입력 방어까지 전부 확인됨
```

서버 로그(`grep -i nan`)에서도 `NaN` 관련 경고가 더 이상 안 나오는 것 확인. `pnpm lint` /
`pnpm --filter @dropfall/shared test` / `pnpm build` 전부 통과.

## 4. 다음 작업
- 이번 버그는 "서버가 클라이언트를 못 믿는다"는 원칙을 범위 검증에서 **타입 검증**까지
  넓혀야 한다는 걸 실제로 보여준 사례. 앞으로 `shared/protocol`에 메시지 타입을 추가할 때마다
  타입 검증을 습관적으로 넣어야 한다
- 브라우저 자동화 도구가 필요하면 별도로 요청해서 연결해야 함 — 이번엔 없어서 로그 분석 +
  서버 사이드 재현으로 대신했다
