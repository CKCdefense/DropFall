# 세션 인계 메모 (2026-08-08)

> 다른 컴퓨터에서 새 Claude Code 세션으로 이어받을 때 **가장 먼저** 읽는 문서.
> 이 세션의 대화 기록 자체는 기기 로컬이라 못 넘어오지만, 실제 작업 결과(코드·
> 문서)는 전부 `origin/develop`에 있다 — git만 받으면 손실 없다.

---

## 0. 지금 이 순간 상태

- `origin/develop` 최신, 로컬도 완전히 clean(커밋 안 된 변경 없음).
- 팀원이 방금(이 문서 작성 직전) **"자원 시스템 리빌딩 — 게이지·충전·레벨업"**
  ([backend/56](56-work-report-resource-rebuild.md))을 올렸고, pull까지는
  받아뒀지만 **아직 내용을 안 읽어봤다** — 다음 작업 시작 전에 먼저 훑을 것.
  `world.ts`에 442줄이 추가된 큰 변경이라(레벨업 데이터 `levels.json`,
  충전 `charging.json` 신설 포함), 뭘 하든 이 변경과 안 부딪히는지 먼저 확인.

---

## 1. 이번 세션에서 한 일 (전부 push 완료)

### 1.1 자기 캐릭터 클라이언트 예측(prediction) + 재조정 — 메인 작업

멀티플레이 중 "화면이 정지했다가 한 번에 튀는" 제보를 원인 분석부터 구현까지
진행. **전체 기록은 [backend/55](55-work-report-player-client-prediction.md)
하나에 처음부터 끝까지 §1~8로 남아 있다** — 이 세션에서 실제로 겪은 시행착오
순서 그대로:

1. 팀원이 공유한 분석 문서 검증 → 근본 원인 확정(카메라가 무보정으로 따라가는
   신호 자체가 네트워크 도착 시각에 의존)
2. `shared/sim`에 `resolvePlayerMove`/`isPlayerBlocked` 순수 함수로 분리 →
   클라이언트 `PlayerPredictor` 신설 → 배선
3. **§5 후속수정**: 재조정이 보간된 좌표 + 다른 시점 seq를 짝지어 쓰던 버그
   (미세 버벅임 원인) → `SnapshotInterpolator.getRawPlayer()` 추가
4. **§6 후속수정**: 채팅/개발자콘솔 DOM이 게임 종료 후에도 안 지워지던 버그
   (예측과 무관한 별개 버그, 같이 발견해서 같이 고침)
5. **§7 후속수정**: 입력 전송 주기(60Hz)와 렌더 주기가 어긋나 계단식으로
   보이던 문제 → `PlayerPredictor.renderPosition()`(짧은 로컬 외삽) 추가
6. **§8 후속수정**: **미니맵의 내 점만 여전히 순간이동하던 버그** — 월드
   화면은 예측으로 고쳤는데 `HudScene`(별도 Scene)이 예측을 몰라서 미니맵은
   그대로 뚫려 있었음 → `registry`로 예측 좌표 공유

**미검증으로 남은 것**: §8(미니맵) 수정은 코드 원인 분석 + 로컬 스모크
테스트까지만 했다. 버그 자체가 네트워크 지터가 있어야 드러나는 거라 로컬
(지터 0)에서는 "진짜 고쳐졌는지" 확인이 안 된다. **다음에 실제 멀티로 접속해서
재확인 필요.**

### 1.2 프로젝트 전체 컨텐츠 완성도 리뷰 (문서화 안 함, 대화에만 있음)

기획서(`01-game-design.md`)·로드맵(`04-roadmap.md`)과 실제 코드/데이터를
대조해서 빠진 것을 정리했다 — **이건 별도 문서로 안 남겼으니 필요하면 이
섹션이 유일한 기록이다.**

- P0(절대 사수)는 전부 완료, 심지어 P2였던 보스도 이미 구현됨
- **빠진 것 1순위**: 직업 패시브/액티브(F키) — `jobs.json` 주석에 아직도
  "스킬·특성은 없다"고 적혀 있음(이 문서 작성 시점 기준 — backend/56에서
  바뀌었을 수도 있으니 재확인할 것)
- **빠진 것 2순위**: 개인 레벨업/스킬트리 — 이 세션 조사 시점엔 0줄이었는데,
  **방금 pull받은 backend/56에 `levels.json`이 새로 생겼다** — 이 갭이
  해소되고 있는 중일 가능성이 큼, 다음 세션에서 확인
- **빠진 것 3순위**: 사운드/BGM — `assets/audio/{bgm,sfx}`가 `.gitkeep`만
  있고 완전히 비어 있음, 코드에서 로드하는 곳도 0건. 무료 CC0 소스를
  사용자에게 안내했음(Kenney.nl Impact/Interface/RPG/UI/Digital Audio,
  Freesound, OpenGameArt, Pixabay, Sonniss GDC 번들) — **아직 코드에
  연결은 안 함**, 사용자가 다운로드하면 `assets/audio/`에 넣고 연결하는 작업
  필요
- 포탑 미구현, `statUpgradesUnlocked` 플래그만 있고 소비 UI 없음
- **문서 정합성**: `docs/02-tech-spec.md`가 `PATCH_RATE`를 아직 "20Hz"라고
  적어놨는데 실제론 60 — 5분짜리인데 계속 미룸
- **AOI(관심 영역)/좌표 양자화**: `docs/02-tech-spec.md` §4.3에 설계는 있는데
  미구현. 지금 인원 규모(3~4인)에선 안 급함

### 1.3 "공격/상호작용이 0.5초 느리다" 제보 조사

- 이동은 예측으로 고쳤지만 **공격·줍기·건축 등은 여전히 100% 서버 왕복을
  기다린다** — 예측이 이동에만 적용됨
- 서버 메시지 핸들러(`GameRoom.ts`의 `messages = {...}`)는 전부 동기 처리,
  `await`/외부 I/O 없음 — **서버 코드가 인위적 지연을 만드는 부분은 없다**고
  확인함
- 내 위치(테스트 환경)에서 잰 RTT는 계속 비정상적으로 낮게(~9ms) 나와서
  사용자가 겪는 실제 지연을 재현 못 했음 — 실제로 원격 위치·Funnel 릴레이
  경로 지연일 가능성이 높다고 결론
- **결론 미확정** — 사용자가 직접 DevTools로 재보기로 했는데 이후 대화가
  다른 버그(미니맵)로 넘어가서 **최종 확인은 안 끝남**. 다음 세션에서
  이어서 물어볼 것.

---

## 2. 핵심 아키텍처 — 새 세션이 헤매지 않으려면 알아야 하는 것

- **`PATCH_RATE = 60`**(`packages/shared/src/constants.ts`), `TICK_RATE`도
  60 — 예측 도입 전엔 이 값을 20↔40↔60 사이에서 계속 튜닝해야 했는데, 예측이
  "내 캐릭터 반응성"을 네트워크에서 분리해줘서 이제 이 값을 인원수 걱정 없이
  건드릴 여유가 생겼다(아직 실제로 낮춰본 적은 없음).
- **클라이언트 예측 구조**:
  - `packages/client/src/net/PlayerPredictor.ts` — 상태 보유(`applyInput`/
    `reconcile`/`renderPosition`)
  - `packages/shared/src/sim/movement.ts`의 `resolvePlayerMove` +
    `packages/shared/src/sim/playerCollision.ts`의 `isPlayerBlocked` —
    서버(`World.movePlayer`)와 클라이언트 예측이 **같은 순수 함수**를 쓴다.
    이동/충돌 규칙을 고칠 땐 반드시 여기를 고쳐야 양쪽이 안 갈라진다.
  - `SnapshotInterpolator.getRawPlayer(id)` — 재조정처럼 "좌표와 seq가 같은
    패치에서 나온 쌍이어야 하는" 경우 반드시 이걸 쓸 것. `.sample()`(보간된
    값)은 좌표와 다른 필드(seq 등)가 서로 다른 시점 것일 수 있다.
- **씬 간 데이터 공유는 `game.registry`**(`createGame.ts`에 키 export) —
  `GameScene`과 `HudScene`은 별도 Phaser Scene이라 서로 직접 참조가 안 된다.
  `LOCAL_POSITION_KEY`가 최근에 추가된 예시.
- **DOM 오버레이(`ChatBox`/`DevConsole`) 정리는 두 이벤트 모두에 걸어야
  한다**: `scene.events...SHUTDOWN` **그리고** `scene.game.events...
  Phaser.Core.Events.DESTROY`. "나가기"가 씬을 정상 종료하는 게 아니라
  `game.destroy(true)`로 통째로 부수는데, 이 경로는 SHUTDOWN을 안 거친다.

---

## 3. 다음에 확인/진행할 것 (체크리스트)

- [ ] backend/56(자원 리빌딩) 읽고 이번 세션 작업과 충돌 없는지 확인
- [ ] 미니맵 예측 수정(§8) — 실제 멀티 접속으로 재현 여부 최종 확인
- [ ] "공격 0.5초 지연" — 사용자가 DevTools로 실측한 RTT 값 받아서 결론
      내기(순수 네트워크 문제인지, 액션에도 예측 필요한지)
- [ ] (낮은 우선순위, 팀 전체 범위) 직업 패시브/액티브, 사운드 연결,
      `docs/02-tech-spec.md`의 PATCH_RATE 오기 수정

---

## 4. 반드시 지킬 작업 규칙 (사용자가 이 세션에서 명시했음)

- **커밋/푸시는 명시적으로 요청받았을 때만.** "일단 pull 받아보자"처럼
  pull만 요청해도 커밋까지 마음대로 하지 않는다 — 다만 로컬에 uncommitted
  변경이 있는 상태로 pull이 막히면(같은 파일을 원격도 고쳤을 때), 먼저
  커밋해야 병합이 되므로 그 경우엔 커밋부터 하고 진행해도 된다(이번 세션에서
  실제로 이 패턴을 여러 번 썼다).
- **`docs/06-client-server-state-flow.md`는 어떤 커밋에도 절대 포함시키지
  않는다.** 매번 `git add`에서 명시적으로 제외할 것.
- **작업 단위마다 `docs/backend/`에 기획-과정-결과 형식 보고서를 남기고
  `docs/README.md` 인덱스도 갱신한다.** 번호는 항상 `ls docs/backend | sort
  -V | tail`로 최신 번호 확인 후 다음 번호 사용 — 여러 사람이 동시에 작업해서
  번호가 겹칠 수 있다(이번 세션에서 실제로 54번이 겹쳐서 55로 재번호했음).
- **커밋 메시지에 한글 따옴표가 들어가면** bash가 오파싱하니 임시 파일에
  써서 `git commit -F <파일>`로 커밋할 것.
- git 워크플로 표준 순서: `git fetch` → 로컬 변경 있으면 먼저 커밋 →
  `git pull`(충돌 나면 신중히 해결, 특히 겹치는 파일은 양쪽 의도를 다 살려서
  합칠 것 — 한쪽을 버리지 말 것) → 전체 재검증(`pnpm --filter @dropfall/shared
  test`, `pnpm --filter @dropfall/server typecheck && test`, `pnpm --filter
  @dropfall/client typecheck`, `pnpm lint`) → `git push`.

---

## 5. 참고 문서 순서

1. 이 문서(빠른 상황 파악)
2. [backend/55](55-work-report-player-client-prediction.md) — 이번 세션
   메인 작업 전체 기록
3. [05-team-notes.md](../05-team-notes.md) — 실행 방법·통신 규격·기술적
   함정 모음(이 세션 이전부터 누적된 것)
4. [04-roadmap.md](../04-roadmap.md) / [01-game-design.md](../01-game-design.md)
   — 전체 기획 대비 뭐가 남았는지 감 잡을 때
