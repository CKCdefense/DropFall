# 작업 보고서 — 테스트용 "웨이브 5로 점프" 버튼

> 5웨이브(보스전) 밸런스를 매번 1~4웨이브를 다 거치지 않고 바로 테스트할 수 있게,
> 로컬 모드 전용 디버그 버튼을 추가했다.

---

## 1. 기획 — 무엇을, 왜

5웨이브(보스 포함)를 테스트하려면 매번 낮/밤 4번을 실제로 다 진행해야 했다 — 실제
플레이 타임 기준 최소 몇 분이 걸린다. 테스트 전용으로 특정 웨이브에 즉시 진입하는
버튼이 필요했다.

적용 범위를 먼저 정했다: 실제 멀티플레이(Colyseus 서버)까지 지원하려면 서버에
메시지 핸들러를 추가하고 방장 권한 체크까지 해야 해서 범위가 꽤 늘어난다. 지금
당장 필요한 건 혼자 하는 밸런스 테스트라 **로컬 모드(`?local=1`)에서만** 동작하도록
범위를 좁혔다 — 실제 운영 빌드(멀티플레이)에는 전혀 노출되지 않는다.

## 2. 과정 — 어떻게 했나

### 2.1 시뮬레이션 — `WaveManager`/`World`

`WaveManager.beginNextWave()`는 항상 `waveIndex`를 1만큼 증가시키면서 스폰 큐/지점을
그 웨이브 설정으로 재구성한다. "특정 웨이브로 점프"는 이 로직을 그대로 재사용하는
게 제일 안전하다 — 스폰 큐 재구성을 중복 구현하지 않기 위해서다.

```ts
debugJumpToWave(waveNumber: number): boolean {
  if (this.phase === 'victory' || this.phase === 'defeat') return false;
  const targetIndex = waveNumber - 1;
  if (targetIndex < 0 || targetIndex >= wavesData.waves.length) return false;

  this.waveIndex = targetIndex - 1; // beginNextWave가 +1 할 걸 감안해서 한 칸 앞으로
  this.beginNextWave();
  return true;
}
```

범위 밖 웨이브 번호나 이미 승리/패배한 상태에서는 `false`를 돌려주고 아무것도 안
한다 — 호출자가 이 값으로 부수 효과(몬스터 정리)를 걸지 말지 판단한다.

`World.debugJumpToWave()`는 이걸 감싸면서, 성공했을 때만 기존 몬스터를 정리한다.
직전 웨이브 몬스터가 필드에 남아 있으면 새 웨이브 몬스터와 섞여 테스트 결과가
헷갈리기 때문이다. 코어/플레이어 HP는 건드리지 않았다 — 테스트하려는 대상(예:
"이 코어 HP에서 웨이브 5를 버틸 수 있나")일 수 있어서 임의로 리셋하면 오히려
테스트를 방해한다.

### 2.2 클라이언트 — GameConnection 인터페이스와 로컬 전용 게이팅

`GameConnection`에 `debugJumpToWave?(waveNumber: number): void`를 **옵셔널**로
추가했다. `LocalConnection`만 구현하고 `ColyseusConnection`은 아예 구현하지 않는다 —
그러면 UI 쪽은 "로컬 모드인지"를 따로 체크할 필요 없이 `connection.debugJumpToWave`가
존재하는지만 보면 자연히 로컬 전용이 된다(존재 여부 자체가 게이팅 역할을 겸한다).

`HudScene`에 실제 클릭 가능한 버튼(`[TEST] WAVE 5로 점프`)을 코어 HP 바 아래에
추가했다. `create()`에서 `connection.debugJumpToWave`가 있을 때만 생성하고,
클릭하면 `connection.debugJumpToWave(5)`를 호출한다.

### 2.3 테스트

- `wave.test.ts`: `debugJumpToWave` describe 블록 4개 — 지정 웨이브로 이동, 그
  웨이브 구성대로 몬스터가 나오는지(5웨이브 전용 타입인 `boss` 포함 여부로 확인),
  범위 밖 웨이브 번호 무시, victory/defeat 상태에서 무시.
- `world-combat.test.ts`: `World — debugJumpToWave` describe 블록 4개 — 웨이브
  이동 + 몬스터 스폰, 이전 웨이브 몬스터 정리, 코어/플레이어 HP 보존, 범위 밖 웨이브
  번호는 기존 몬스터도 그대로 두는지.
- Playwright로 실제 브라우저(`?local=1`)에서 버튼을 클릭해 WAVE 1 준비 → WAVE 5 밤
  전환과 5웨이브 몬스터(보스 포함 구성) 스폰을 시각적으로 확인했다.

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/shared test     # 97 passed (기존 89 + 신규 8)
pnpm typecheck                          # client/server 전체 통과
pnpm lint                               # 에러 0
pnpm build                              # client(vite)/server(tsup) 전체 통과
```

Playwright로 실제 클릭 → WAVE 5 전환 및 몬스터 스폰까지 확인. 전부 통과.

## 4. 다음 작업

- 지금은 로컬 모드 전용이다. 팀원과 함께 멀티플레이 상태로 5웨이브를 테스트해야
  하는 상황이 생기면, `GameRoom`에 방장 전용 메시지 핸들러를 추가하고
  `ColyseusConnection.debugJumpToWave()`를 구현하는 확장이 필요하다 — 지금은 그
  요구가 없어서 미룸(질문 시 "로컬 전용" 범위로 명시적으로 선택함).
- 버튼은 웨이브 5 고정이다. 임의 웨이브 번호를 입력받는 UI(텍스트 인풋 등)는
  지금 필요가 없어서 안 만들었다 — `World.debugJumpToWave(waveNumber)` 자체는
  이미 임의 웨이브를 받으니, 필요해지면 UI만 추가하면 된다.
