# DropFall AI 활용 기술 문서

- 게임명: DropFall
- 팀명: [팀명]
- 제출자: [팀원 이름 또는 팀명]
- 작성일: 2026-08-10


## 1. AI 활용 개요

DropFall은 AI 동료 함께, 몰려오는 몬스터로부터 코어를 방어하는 멀티 실시간 디펜스 게임 입니다.

본 프로젝트에서는 두 가지 방식으로 AI를 활용했습니다.

1. **개발 과정의 AI 활용**
   - Claude Code를 활용하여 게임 기획, 코드 구현, 리팩터링, 테스트 코드 작성 및 오류 분석을 보조했습니다.

2. **게임 내 AI 활용**
   - AI 동료(티모시)는 전장 내 자원 탐색·채집 자체는 규칙 기반(rule-based) 상태머신으로 자동 수행합니다.
   - 플레이어가 채팅에서 `@티모시`로 말을 걸면, 그 순간에만 LLM이 Tool Calling으로 실제 게임 상태(창고 자원량, 웨이브 상태, 티모시 자신의 상태)를 조회한 뒤 캐릭터로서 자연어로 응답합니다.

AI는 개발 및 게임 내 행동을 보조하는 역할로 활용했으며, 게임 규칙과 최종 구현 방향은 팀이 직접 검토하고 결정했습니다.

## 2. 개발 과정에서의 AI 도구 활용

### 2.1 활용 도구

본 프로젝트에서는 **Claude Code**를 주요 AI 개발 보조 도구로 활용했습니다.

| 활용 도구 | 활용 영역 | 주요 활용 내용 |
|---|---|---|
| Claude Code | 기획 | 기능 스펙 문서 초안 작성 보조 (예: `docs/superpowers/specs/2026-08-07-ai-companion-timothy-design.md`) |
| Claude Code | 구현 | Colyseus 서버 / Phaser 클라이언트 / 공유 시뮬레이션(`packages/shared/src/sim`) 로직 구현 보조 |
| Claude Code | AI 기능 개발 | Anthropic Messages API 연동(`corePersonaClient.ts`), Tool Calling 도구 3종 구현(`companionTools.ts`) 보조 |
| Claude Code | 테스트 및 디버깅 | Vitest 유닛 테스트 작성(fetch mock 기반 26개 케이스 등), 회귀 테스트, 버그 재현 후 수정 |
| Claude Code | 리팩터링 | 채팅 쿨다운 큐잉 로직 개선 등 중복/누락 로직 정리 |
| Claude Code | 문서화 | `docs/backend/`, `docs/frontend/`의 작업 보고서(기획-과정-결과) 수십 건, 세션 인계 문서(`docs/backend/claudesession.md`) 작성 |


### 2.2 AI 활용 개발 절차

프로젝트는 AI에게 전체 게임을 일괄 생성하도록 요청하는 방식이 아니라,
기능 요구사항을 분리하고 각 기능을 검증하며 구현하는 방식으로 진행했습니다.

1. 팀이 구현할 기능과 게임 규칙을 정의했습니다.
2. Claude Code에 기존 프로젝트 구조, 구현 범위 및 제약 조건을 전달했습니다.
3. AI가 구현 또는 수정 방향을 제안하고, 코드 작성을 보조했습니다.
4. 팀이 생성된 코드를 검토하여 프로젝트 구조 및 게임 요구사항과의 일치 여부를 확인했습니다.
5. 신규·수정 기능에 대한 테스트 로직을 작성하고 실행했습니다.
6. 기존 기능에 영향이 없는지 회귀 테스트와 실제 플레이 테스트를 수행했습니다.
7. 검증된 기능만 프로젝트에 반영했습니다.

작업 규칙도 명시적으로 정해 AI에게 전달했습니다(예: 커밋/푸시는 명시적으로 요청받았을 때만 수행, 작업 단위마다 `docs/backend/`·`docs/frontend/`에 기획-과정-결과 보고서를 남기고 `docs/README.md` 인덱스도 갱신 — `docs/backend/claudesession.md` §4 참고).


### 사례 1. 기능 구현 요청

#### 요청 목적
채팅에서 AI 동료를 부를 때마다 "@티모시"를 전부 입력해야 하는 불편함을 줄이기 위한 멘션 자동완성 기능

#### 프롬프트
```text
[실제 대화 프롬프트 원문은 로컬 세션 기록에만 남아 있어 이 문서에는 없음 — 담당 팀원이 직접 채워 넣을 것]
```

#### 활용 결과
- AI가 보조한 구현: 채팅 입력창에서 `@`로 시작한 상태에서 Tab을 누르면 `@티모시 `로 자동 완성(`packages/client/src/game/ui/ChatBox.ts`의 `completeMention()`), 입력창 옆에 "@+Tab: 티모시" 힌트 상시 노출
- 팀이 직접 검토·수정한 내용: 멘션 대상이 티모시 하나뿐이라 후보 목록 없이 즉시 완성되도록 범위를 제한
- 검증 방법: Playwright로 `@+Tab → "@티모시 " 자동완성 → 이어 입력 → 전송`까지 수동 시나리오 확인, 콘솔 에러 없음 확인 (커밋 `70df9cb`)

### 사례 2. 테스트 및 회귀 검증 요청

#### 요청 목적
그동안 실제 hchat을 호출하는 유료 통합 테스트(`test:integration`)로만 검증되던 LLM 연동 프로토콜(요청 헤더/바디, 도구 왕복, 에러 처리, 무한루프 방지)에 빠르고 결정론적인 fetch mock 기반 유닛 테스트를 추가

#### 프롬프트
```text
[실제 대화 프롬프트 원문은 로컬 세션 기록에만 남아 있어 이 문서에는 없음 — 담당 팀원이 직접 채워 넣을 것]
```

#### 확인 항목
- provider 자동 선택(direct/hchat 키 우선순위) 정상 동작
- 성공/실패/빈 응답/네트워크 오류 시 처리, direct·hchat 헤더 차이 처리
- 도구 없이 즉답하는 경우와, 도구 호출 → 결과 반영 → 최종 답변까지 왕복하는 경우 모두 정상 동작
- 도구 실행 중 예외가 나도 루프가 죽지 않고, 무한 도구 요청 시 상한(4회) 이후 `null` 반환
- `get_storage`/`get_wave_status`/`get_companion_status` 3종이 실제 `World` 상태(창고/웨이브/티모시 상태)를 정확히 읽어오는지
- 알 수 없는 도구 이름을 요청하면 예외 대신 에러 객체를 반환하는지

(결과: `corePersonaClient.test.ts` 26개 케이스, `companionTools.test.ts` 신설, `pnpm test`에 자동 편입 — 커밋 `8fc3b7b`)


### 사례 3. 오류 분석 및 수정 요청

#### 요청 목적
채팅으로 `@티모시 ...`를 연속으로 물어보면 두 번째 질문에 대한 답이 오지 않는 문제

#### 프롬프트
```text
[실제 대화 프롬프트 원문은 로컬 세션 기록에만 남아 있어 이 문서에는 없음 — 담당 팀원이 직접 채워 넣을 것]
```

#### 해결 과정
- 문제 상황: `playerMessageCooldownSeconds`(8초) 안에 다시 말을 걸면 `sendCompanionMessage`가 조용히 `false`를 반환하고 이벤트 자체를 버려서, 채팅 로그엔 질문이 보이는데 답은 영영 오지 않는 것처럼 보였습니다.
- 원인 분석: 쿨다운 중 들어온 질문을 큐에 남기지 않고 즉시 폐기하는 구조였습니다.
- 수정 내용: 쿨다운 중 질문을 버리지 않고 FIFO 큐(`queuedCompanionMessages`, 최대 3개 `MAX_QUEUED_COMPANION_MESSAGES`)에 저장한 뒤, 쿨다운이 끝나는 tick마다 가장 오래된 질문 하나씩 자동으로 내보내도록 수정(`tickQueuedCompanionMessages`). 큐 한도를 넘는 진짜 스팸은 여전히 거절합니다.
- 검증 결과: Vitest로 큐잉/쿨다운 종료 후 자동 처리/순서(FIFO) 유지/큐 초과 시 거절 케이스를 모두 검증 (`packages/shared/tests/ai/companionPersona.test.ts`, 커밋 `422eb84`)

## 3. 게임 내 AI 활용

DropFall은 단순한 규칙 기반 NPC가 아닌, LLM API와 Tool Calling을 활용하는 AI 동료를 게임 내에 적용했습니다.

AI 동료(티모시)의 자원 탐색·채집 행동 자체는 규칙 기반 상태머신(`seeking → traveling → harvesting → returning → depositing`)으로 자동 수행되며 LLM은 관여하지 않습니다.
대신 플레이어가 채팅으로 `@티모시`를 멘션하면, 그 순간에만 LLM이 게임 상태 조회용 Tool을 호출해 실제 수치(창고 자원량, 웨이브 상태, 티모시 자신의 상태)를 확인한 뒤 캐릭터로서 자연어로 답합니다.
플레이어가 몬스터 처치 및 코어 방어에 집중하는 동안, AI 동료는 자원 수급을 지원하고 필요할 땐 대화 상대가 되어 줍니다.

AI 동료의 채팅 응답은 LLM이 대화 맥락과 역할 지시를 바탕으로 필요한 Tool을 선택하고,
서버가 허용된 Tool 이름인지 검증한 뒤 실행 결과를 프롬프트에 다시 반영하는 방식으로 구현했습니다.

### 3.1 현재 구현된 AI 동료 기능

| 기능 | 설명 | 현재 구현 여부 |
|---|---|---|
| 자원 탐색·채집 | 전장의 자원 노드를 찾아 이동·채집·코어 창고 반납까지 자동 수행 (규칙 기반 상태머신, LLM 미관여) | 구현 |
| 게임 상태 인식(채팅 질의 시) | `@티모시` 멘션 시 창고 자원량·웨이브 상태·자신의 hp/보유자원/행동 상태를 Tool Calling으로 조회 | 구현 |
| LLM API 호출 | 서버가 Anthropic Messages API를 호출해 대사/답변 생성 (이벤트 발생 시, 채팅 멘션 시) | 구현 |
| Tool Calling | 정의된 3개 읽기 전용 도구를 LLM이 호출하고, 서버가 검증 후 실행 | 구현 |
| 자연어 채팅 질의응답 | 플레이어가 `@티모시 <질문>`으로 물으면 LLM이 실제 게임 상태를 조회해 자연어로 답변 | 구현 |
| 전투 참여 | - | 향후 계획 |
| 자연어 채팅 행동 지시 (예: "저기 가서 채집해") | 현재는 질의응답만 가능, 행동 지시·실행은 미구현 | 향후 계획 |


## 4. AI 동작 구조

AI 동료의 채팅 응답은 다음 흐름으로 처리됩니다. (자원 탐색·채집은 이 흐름과 별개로 규칙 기반 로직이 매 tick 처리합니다.)

1. 플레이어가 채팅에 `@티모시 <질문>`을 입력합니다.
2. 서버(`World.sendCompanionMessage`)가 멘션을 감지하고, 쿨다운(8초)을 확인한 뒤 이벤트를 발생시킵니다.
3. 서버가 역할 프롬프트, 현재 무드(trust/efficiency/recklessness), 최근 대화 기록(최대 6턴), 사용 가능한 Tool 목록을 구성해 LLM API에 전달합니다.
4. LLM은 답변에 필요한 실제 수치가 있으면 Tool Calling 응답을 반환합니다.
5. 서버는 호출된 Tool 이름이 허용 목록(3개) 안에 있는지 검증한 뒤 실행하고, 결과를 다시 LLM에 돌려줍니다(최대 4회 왕복).
6. LLM은 Tool 실행 결과를 반영해 최종 자연어 대사를 생성합니다.
7. 서버가 생성된 대사를 게임 상태(채팅 로그/말풍선)에 반영하고, 클라이언트 화면에 표시합니다. API 실패·타임아웃(5초) 시에는 폴백 대사로 대체합니다.

### 구조도
```
[게임 클라이언트 (Phaser 3)]
  - 플레이어 조작(이동/공격/채팅)
  - "@" + Tab 티모시 멘션 자동완성
  - AI 동료 행동/대사 표시
            │  WebSocket (Colyseus 상태 동기화)
            ▼
[게임 서버 (Colyseus Room, 서버 권위)]
  - 자원 채집: 규칙 기반 상태머신 (LLM 비관여, 매 tick 처리)
  - 채팅에서 "@티모시 ..." 감지 시에만 아래 AI 로직 트리거
            │
            ▼
[AI 페르소나 로직 (corePersonaClient.ts / companionPersona.ts)]
  - 역할 프롬프트 + 무드(trust/efficiency/recklessness) + 대화 기록 구성
  - 사용 가능 Tool 목록 첨부
            │
            ▼
[Anthropic Messages API (claude-haiku-4-5)]
  - 자연어 응답 또는 Tool Calling 응답 생성
            │
            ▼
[Tool 실행 및 검증 (companionTools.ts)]
  - get_storage / get_wave_status / get_companion_status (읽기 전용, 화이트리스트 3종)
  - 최대 4회 왕복 제한, 5초 타임아웃
            │
            ▼
[게임 상태 갱신]
  - 생성된 대사를 채팅/말풍선에 브로드캐스트
  - 실패 시 폴백 대사로 대체
```


## 5. LLM API 및 Tool Calling 구현

### 5.1 사용 모델 및 연동 환경

| 구분 | 내용 |
|---|---|
| LLM 제공사 | Anthropic |
| 사용 모델 | claude-haiku-4-5 (기본값, 환경변수 `CORE_PERSONA_MODEL`/`H_CHAT_API_MODEL`로 변경 가능) |
| API 호출 위치 | 서버 (`packages/server/src/persona/corePersonaClient.ts`, Node 내장 `fetch`로 직접 호출) |
| 게임 서버 기술 | Node.js + Colyseus(실시간 상태 동기화) + Express |
| 클라이언트 기술 | Phaser 3 (TypeScript, Vite 빌드) |
| 통신 방식 | WebSocket (Colyseus Schema 기반 상태 델타 동기화) |

API는 두 경로 중 하나로 호출합니다: Anthropic API 직접 호출(`https://api.anthropic.com/v1/messages`) 또는 사내 게이트웨이(hchat) 경유. 어느 쪽을 쓸지는 설정된 환경변수(API 키)에 따라 자동으로 결정됩니다.

### 5.2 현재 구현된 Tool 목록

| Tool 이름 | 역할 | 입력값 | 반환값 또는 실행 결과 |
|---|---|---|---|
| `get_storage` | 코어 창고에 지금 쌓여 있는 자원(나무/돌/부품) 개수 확인 | 없음 | `{ wood, stone, parts }` |
| `get_wave_status` | 현재 몇 번째 웨이브인지, 낮/밤 중 어느 쪽인지, 남은 시간 확인 | 없음 | `{ wave, phase, phaseTimeRemainingSeconds }` |
| `get_companion_status` | 티모시 자신의 체력, 보유 자원, 현재 행동(채집 중/이동 중/다운 등) 확인 | 없음 | `{ hp, maxHp, carriedWood, carriedStone, state }` |

세 도구 모두 **읽기 전용**이며 게임 상태를 변경하지 않습니다. 이름 그대로 "질문에 답하기 위한 조회"만 수행합니다(`packages/server/src/persona/companionTools.ts`).


### 5.3 Tool Calling 처리 방식

LLM은 게임 상태를 직접 수정하지 않습니다.
LLM은 사전에 정의된 Tool을 호출할 수 있으며, 실제 게임 상태 변경은 서버의 검증 로직을 통과한 경우에만 수행됩니다.

| 단계 | 처리 내용 |
|---|---|
| 1 | 게임 상태 및 AI 역할 정보를 LLM에 전달 |
| 2 | LLM이 필요 시 Tool Calling 응답 생성 |
| 3 | 서버가 호출 Tool 및 인자값 검증 |
| 4 | 게임 규칙에 부합하는 경우 Tool 실행 |
| 5 | 실행 결과를 게임 상태에 반영 |
| 6 | 결과를 다음 AI 판단 또는 클라이언트 화면에 활용 |


## 6. AI 대상 주요 프롬프트 및 지시 사항

### 6.1 AI 동료 역할 지시

티모시(AI 동료) 시스템 프롬프트 (`packages/shared/src/sim/companionPersona.ts`):
```text
너는 생존 디펜스 게임 DropFall의 AI 동반자 "티모시"다. 자원을 채집해 나르는
작은 로봇이자 팀의 마스코트다. 지금 말을 거는 대상 플레이어와의 관계에 따라 성격이 변한다 —
지금 그 플레이어를 향한 무드는 "{mood}"(trust={trust}, efficiency={efficiency}, recklessness={recklessness}).
한국어로, 짧게 한 문장만 대사로 말해라. 설명이나 따옴표 없이 대사 자체만 출력해라.
```
채팅 멘션(`@티모시 ...`)일 때는 이어서 유저 메시지로 다음을 덧붙여 전달합니다(직전 대화 기록 최대 6개도 함께 첨부):
```text
이 플레이어가 채팅으로 너에게 직접 말을 걸었다: "{실제 메시지}". 그 말에 대답해줘.
```

코어(중앙 코어) 시스템 프롬프트 (`packages/shared/src/sim/corePersona.ts`, Tool Calling 없이 대사만 생성):
```text
너는 생존 디펜스 게임 DropFall의 중앙 코어다. 불시착한 생존자들이 구조 신호를 보내려고
지키고 있는 장치이자 유일한 말동무다. 플레이어들의 행동에 따라 성격이 변한다 — 지금 네
무드는 "{mood}"(trust={trust}, efficiency={efficiency}, recklessness={recklessness}).
한국어로, 짧게 한 문장만 대사로 말해라. 설명이나 따옴표 없이 대사 자체만 출력해라.
```

두 페르소나 모두 `trust`/`efficiency`/`recklessness`(-10~10) 3개 수치로 무드(warm/cold/neutral)를 계산하며, 이벤트(코어 납품, 근접 상호작용, 다운, 부활, 웨이브 종료, 채팅 등)마다 값이 조금씩 바뀝니다.

### 6.2 LLM에 전달하는 게임 상태

| 상태 정보 | 전달 방식 |
|---|---|
| AI 동료 위치 | 전달 안 함 |
| 자원 위치 | 전달 안 함 |
| 자원 상태(수량 제외 위치/거리 등) | 전달 안 함 |
| AI 동료 상태(체력/보유자원/행동상태) | Tool 조회 (`get_companion_status`, 필요 시에만) |
| 보유 자원(창고 기준) | Tool 조회 (`get_storage`, 필요 시에만) |
| 웨이브/낮밤/남은 시간 | Tool 조회 (`get_wave_status`, 필요 시에만) |
| 무드/관계 수치(trust·efficiency·recklessness), 웨이브 번호, 이벤트 종류, 채팅 메시지·대화 기록(최대 6턴) | 프롬프트에 상시 포함 |

AI 동료의 좌표, 자원 노드 위치, 몬스터 위치, 코어 HP는 프롬프트에도 Tool 결과에도 포함되지 않습니다.

### 6.3 안전 및 제약 조건

AI 동료가 게임 규칙을 벗어난 행동을 하지 않도록 다음 제약을 적용했습니다.

- LLM은 정의된 3개 Tool(`get_storage`/`get_wave_status`/`get_companion_status`) 외의 어떤 게임 기능도 직접 호출할 수 없습니다.
- 세 Tool은 모두 읽기 전용이라, LLM이 게임 상태를 변경하는 것 자체가 구조적으로 불가능합니다.
- 알 수 없는 도구 이름이 요청되면 예외를 던지지 않고 에러 객체를 반환해 응답 루프가 깨지지 않게 합니다.
- Tool 왕복 횟수를 4회로 제한해 모델이 도구 호출을 무한 반복하지 못하게 합니다.
- API 요청에 5초 타임아웃을 두고, 실패·타임아웃 시 항상 폴백 대사로 대체하여 API 장애가 "AI가 응답하지 않음"으로 보이지 않게 합니다.
- 채팅 멘션 응답에는 8초 쿨다운을 적용하고, 쿨다운 중 들어온 질문은 버리지 않고 큐(최대 3개)에 쌓아 순서대로 처리합니다.


## 7. 향후 확장 계획

현재 AI 동료는 자원 탐색·채집(규칙 기반)과 채팅 질의응답(LLM Tool Calling)을 수행합니다.
향후에는 현재의 LLM API 및 Tool Calling 구조를 기반으로 다음 기능을 확장할 계획입니다.

- 이동, 전투, 방어, 아이템 사용 등 AI 행동을 실제로 변경하는 Tool 추가 (현재는 읽기 전용 조회 Tool만 존재)
- 플레이어가 채팅을 통해 AI 동료에게 자연어로 행동을 지시하는 기능
- 코어 체력, 몬스터 위치, 자원 분포 등을 고려한 상황 인식 고도화(현재는 프롬프트/Tool 어디에도 포함되지 않음)
- 외부 API 의존도를 줄이기 위한 Local LLM 적용 검토

위 기능은 현재 구현된 기능과 구분되는 **향후 개발 계획**입니다.

## 8. 외부 에셋 및 오픈소스 출처

### 8.1 오픈소스 및 라이브러리

| 분류 | 이름 | 사용 목적 | 라이선스 | 출처 링크 |
|---|---|---|---|---|
| 게임 엔진 | Phaser | 클라이언트 렌더링/입력/카메라/타일맵 | MIT | https://phaser.io/ |
| 클라이언트 빌드 도구 | Vite | 클라이언트 빌드/개발 서버 | MIT | https://vitejs.dev/ |
| 실시간 멀티플레이 프레임워크 | Colyseus (colyseus, @colyseus/schema, @colyseus/ws-transport, @colyseus/sdk) | 서버 권위 방(Room) 관리, 상태 델타 동기화, WebSocket 전송, 클라이언트 접속 | MIT | https://colyseus.io/ |
| 백엔드 프레임워크 | Express | 서버 HTTP 엔드포인트 | MIT | https://expressjs.com/ |
| 데이터 검증 | zod | 밸런스 데이터(JSON) 런타임 스키마 검증 | MIT | https://zod.dev/ |
| 테스트 프레임워크 | Vitest | 유닛/통합 테스트 | MIT | https://vitest.dev/ |
| 폰트 | Galmuri | 한글 픽셀 폰트(게임 UI·HUD) | SIL Open Font License 1.1 | https://github.com/quiple/galmuri |
| LLM API | Anthropic Claude API (claude-haiku-4-5) | AI 동료/코어 페르소나 대사 생성 및 Tool Calling | Anthropic 서비스 이용약관 | https://www.anthropic.com/ |

### 8.2 외부 사운드 에셋

현재 사운드/BGM은 코드에 연결되어 있지 않습니다(`assets/audio/{bgm,sfx}`가 비어 있음, `.gitkeep`만 존재). 무료 CC0 소스(Kenney.nl, Freesound, OpenGameArt, Pixabay, Sonniss GDC 번들 등)를 후보로 검토했으나, 이 문서 작성 시점까지 실제 파일 도입·연결은 진행되지 않았습니다.

| 에셋명 | 제작자 | 사용 위치 | 출처 | 라이선스 |
|---|---|---|---|---|
| (미적용) | - | - | - | - |

몬스터 스프라이트는 재배포가 금지된 상용 라이선스 에셋을 사용하며, 라이선스 조건상 공개 저장소에는 포함하지 않고 비공개 저장소(`CKCdefense/dropfall-assets`)에서 배포 빌드 시점에만 주입합니다(`assets/sprites/monsters/README.md`). 정확한 에셋 팩 명·제작자명은 [구매 담당 팀원이 크레딧에 기입]해야 합니다.

### 8.3 출처 사이트

사운드 작업 시 후보로 검토한 사이트(현재 실제로 사용 중인 에셋은 없음):

- Kenney: https://kenney.nl/
- Freesound: https://freesound.org/
- OpenGameArt.org: https://opengameart.org/
