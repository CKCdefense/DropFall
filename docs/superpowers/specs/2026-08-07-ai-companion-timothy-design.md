# AI 동반자 "티모시" 설계

## 배경 / 목적

기존에 구현한 코어 AI 페르소나(트레잇 기반 대사 생성)는 "말하는 장치"였다. 이번엔 유저가
실제로 애정을 느낄 수 있는, **맵 위를 직접 돌아다니는 캐릭터**를 추가한다. 해커톤 PoC 일정을
고려해 기능은 한 번에 다 만들지 않고, **자원 채집/운반 하나만** 먼저 만든다. 전투 보조나
대사(LLM 연동)는 이번 스코프가 아니다 — 이동/채집 기반이 검증된 뒤에 얹는다.

이름은 "티모시"로 정하되, 나중에 바꿀 수 있게 데이터(JSON)에 둔다.

## 범위 확정 사항 (브레인스토밍으로 결정됨)

- 코어를 키우는 게 아니라 **완전히 별도의 캐릭터**
- **방(팀)당 1마리**, 플레이어별 아님
- 기능은 **자원 채집/운반만**(전투 보조는 다음 단계)
- 자원 종류 구분 없이 **가장 가까운 노드**를 캔다
- 업그레이드 시스템이 없으므로 속도/용량은 **JSON 고정값**
- **몬스터에게 공격당할 수 있다** — hp 0 되면 다운, 사람과 똑같이 **다음 낮 시작(`onDayBegan`)
  때 자동 리셋**. 새 다운/부활 상호작용은 만들지 않는다(기존 부활 자체가 사람도 없음 —
  전원 다운 시 즉시 패배, 낮 시작 시 전원 풀피 리셋 두 가지뿐).
- 비주얼은 기존 직업 스프라이트를 틴트해서 재사용, 스프라이트 키는 상수 하나로 빼서 나중에
  전용 그림으로 교체 가능하게
- 대사 없음(무언). LLM/페르소나 연동은 다음 단계

## 아키텍처

`players`/`monsters`처럼 별도 관리 구조를 만들지 않는다. 방당 1마리라 `World`에 필드
하나(`private companion: CompanionEntity`)로 충분하다. 몬스터 시스템에 얹어 재사용하는
방안은 기각했다 — `getRemainingMonsters()`가 `this.monsters` 맵을 그대로 세는데
티모시가 섞이면 웨이브 클리어 판정이 깨진다.

### 데이터 — `packages/shared/src/data/companion.json` (신규)

```json
{
  "name": "티모시",
  "moveSpeed": 90,
  "harvestRange": 24,
  "harvestDamage": 6,
  "harvestIntervalSeconds": 0.8,
  "capacity": 20,
  "maxHp": 40,
  "spawnOffset": { "x": -80, "y": 0 }
}
```
`packages/shared/src/data/index.ts`에 기존 패턴(zod 스키마 + `loadData()`)으로 추가.

### 엔티티 — `packages/shared/src/sim/companion.ts` (신규)

```ts
export type CompanionState =
  | 'seeking' | 'traveling' | 'harvesting' | 'returning' | 'depositing' | 'downed';

export interface CompanionEntity {
  x: number; y: number;
  facingX: number; facingY: number;
  state: CompanionState;
  targetNodeId?: string;
  carriedWood: number;
  carriedStone: number;
  hp: number;
  maxHp: number;
  harvestTimer: number;
}
```

### 상태머신 (World.tickCompanion(dtSeconds) 안에서 처리)

```
seeking → traveling → harvesting → (용량 안 참 → seeking 반복 / 참 → returning) → depositing → seeking
                                                                                      ↑
                                                                    (몬스터에게 맞아 hp 0) → downed
                                                                                      ↓
                                                          (다음 낮 시작, onDayBegan) → hp 회복 → seeking
```

- **seeking**: `resourceNodes` 중 `hp > 0`인 가장 가까운 노드를 타겟. 없으면 대기.
- **traveling**: 타겟 좌표로 직진 조준 이동. 막히면 축 밀기 → 그래도 막히면 장애물 접선
  우회(몬스터 이동의 4단계 폴백 패턴을 참고해 새로 작성 — 분리(separation) 벡터는 불필요,
  1마리뿐이라 다른 개체 회피 대상이 없다). **장애물 판정은 플레이어 이동이 쓰는 것과 같은
  정적 장애물 집합(건물/콜로니/코어 발자국)을 기준으로 한다** — 몬스터 전용 판정
  (`isBlockedForMonster`)을 그대로 쓰지 않는다. 도중 노드가 고갈되면 다시 seeking.
  `harvestRange` 안에 들어오면 harvesting.
- **harvesting**: 제자리에서 `harvestIntervalSeconds`마다 노드 hp를 `harvestDamage`만큼 깎는다
  (사람의 근접 채집과 동일한 개념, 무기/인벤토리 없이 고정 상수로). 노드 hp가 0이 되면:
  - **바닥에 드랍 아이템을 만들지 않는다** — `yieldOnDeplete`만큼 바로
    `carriedWood`/`carriedStone`에 더한다. 노드의 리스폰 타이머/장애물 재계산 등 기존
    부수효과(사람이 캘 때와 동일)는 그대로 유지한다.
  - `carriedWood + carriedStone >= capacity`면 returning, 아니면 다시 seeking.
- **returning**: 코어(원점) 방향으로 같은 이동 로직.
- **depositing**: `isWithinCoreInteract()`(코어 상호작용 판정에 이미 쓰이는 그 함수) 범위
  진입 시 `core.storage.add('wood', carriedWood)` + `add('stone', carriedStone)` 한 번에
  반영, 둘 다 0으로 리셋 → seeking.
- **downed**: hp가 0 이하가 되면 즉시 진입, 그 자리에서 아무것도 안 함(이동/채집 중단,
  들고 있던 자원은 유지). `World.onDayBegan()`(밤이 끝나고 낮이 시작되는, 사람 전원
  풀피되는 바로 그 지점)에 `hp = maxHp`, `state = 'seeking'`로 되돌리는 코드를 추가한다.
  새 상호작용/타이머/UI를 만들지 않는다 — 사람 부활 자체가 없는 것과 동일한 층위로 다룬다.

### 피격

몬스터의 어그로 타겟 탐색(현재 `this.players`만 스캔하는 부분)에 티모시를 후보로 추가한다.
맞으면 기존 `damagePlayer()`류 공용 데미지 경로와 동일하게 hp가 깎인다. 이 변경은 몬스터
집계(`getRemainingMonsters`) 로직과는 무관한 별도 지점이라 앞서 기각한 "몬스터로 위장" 방안의
리스크와 무관하다.

**다운 상태 제외**: 몬스터는 `hp <= 0`인 플레이어를 타겟에서 제외하는 기존 규칙이 있다
(죽은 대상을 계속 쫓지 않는다). 티모시도 `state === 'downed'`(= `hp <= 0`)면 같은 방식으로
타겟 후보에서 제외한다 — 이미 다운된 대상을 몬스터가 무의미하게 계속 노리지 않게 한다.

## 네트워킹

### 서버 — `packages/server/src/schema/GameRoomState.ts`

```ts
export class CompanionSchema extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('string') state = 'seeking';
  @type('number') carriedWood = 0;
  @type('number') carriedStone = 0;
  @type('number') hp = 0;
  @type('number') maxHp = 0;
}
```
`GameRoomState`에 `@type(CompanionSchema) companion = new CompanionSchema();` 필드 하나
(맵 아님 — 콜로니처럼 절대 사라지지 않는 단일 개체). `GameRoom.update()`에 기존 sync 패턴과
동일한 `syncCompanion()` 메서드 추가.

### 클라이언트

- `GameConnection.ts`: `CompanionView`(x/y/state/carriedWood/carriedStone/hp/maxHp) 추가,
  `WorldSnapshot.companion`으로 노출
- `ColyseusConnection`/`LocalConnection` 둘 다 `readRawSnapshot()`에 반영
- **보간 필요**: 코어(고정 위치)와 달리 티모시는 매 틱 움직이므로 플레이어/몬스터처럼
  `SnapshotInterpolator`의 위치 보간 대상이어야 한다(상태 필드처럼 "항상 최신값"으로 처리하면
  패치 주기마다 뚝뚝 끊겨 보인다) — tech-spec의 "위치 있는 엔티티는 100ms 버퍼 두고 보간"
  원칙 그대로 적용.

## 렌더링

- `EntityRenderer.ts`: 기존 직업 스프라이트(예: 탐색꾼) 하나를 틴트 입혀 재사용. 스프라이트
  키는 상수 하나(`COMPANION_SPRITE_KEY`)로 빼서 나중에 전용 그림으로 교체 시 이 한 줄만
  바꾸면 되게 한다.
- 닉네임 라벨과 같은 방식으로 머리 위에 "티모시" 텍스트 표시.
- `downed` 상태일 때는 시각적으로 구분(틴트를 어둡게 하는 정도로 충분, v1에서 별도
  스프라이트/애니메이션 만들지 않는다).
- 들고 있는 자원 수 표시는 선택사항(v1 필수 아님, 없어도 기능은 완결됨).

## 테스트

- `packages/shared/tests/companion.test.ts` — **`tests/ai/`가 아니라 일반 위치**에 둔다.
  `tests/ai/`는 LLM 연동(코어 페르소나) 전용 폴더이고, 티모시는 룰베이스 로직이라 LLM이
  전혀 관여하지 않는다. `colony.test.ts`/`wave.test.ts`와 같은 급으로 취급한다.
- 검증 항목:
  - 가장 가까운 노드를 찾아 이동 → 채집 → 노드 고갈 시 carriedWood/Stone 증가
  - 채집 시 **바닥에 드랍 아이템이 생기지 않는지**(의도적으로 생략한 부분이라 명시적 검증 필요)
  - 용량 초과 시 returning으로 전환, 코어 도착 시 적립 + 리셋
  - 몬스터 공격으로 hp 0 되면 downed 전환, 이동/채집 중단
  - `onDayBegan()` 호출 시 hp/상태 리셋
- 수동 검증: 이전 세션에서 쓴 Playwright 로컬모드 드라이버 재사용(로컬 모드로 띄우고
  캐릭터가 실제로 돌아다니며 채집하는지 스크린샷으로 확인).

## 다음 단계(이번 스코프 아님)

- 전투 보조(몬스터 밀치기 등)
- LLM 페르소나 대사 연동(이미 만든 코어 페르소나 시스템 재사용 가능)
- 다운 시 플레이어가 직접 부활시키는 상호작용(지금은 낮 시작 자동 리셋으로 대체)
- 전용 스프라이트/애니메이션
