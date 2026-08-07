# 요약 — backend/05 ~ backend/28 (서버 초기 구축 ~ 자원채집·건축 MVP)

> 이 구간(05~28)의 개별 작업 보고서/제안서 24건을 주제별로 묶어 요약한다. 각
> 항목이 실제로 무엇을 했는지 빠르게 훑어보는 용도이고, 세부 구현/코드/재현
> 과정이 필요하면 링크된 원본 문서를 열어볼 것 — 원본은 지우지 않고 그대로
> 둔다. backend/29 이후(콜로니, 히트박스, 병합 등 최근 작업)는 이 요약에서
> 제외했다 — [docs/README.md](../README.md)에서 개별 문서로 계속 관리한다.

---

## A. 서버 초기 세팅 & 연결 검증 (05~10)

기획서 압축부터 시작해, 클라이언트가 아직 없는 상태에서 서버만으로 프로토콜을
끝까지 검증하는 인프라를 다졌다.

- [05](05-backend-demo-plan.md) — 8주 로드맵을 예선 데모(1~2주) 기준 P0/P1/P2로
  압축한 서버 담당(역할 A) 범위 기획서.
- [06](06-backend-setup-notes.md) — 실제 스캐폴딩 트러블슈팅 기록. Colyseus
  0.17의 `defineServer`/`defineRoom` API가 흔한 예제(0.14~0.16)와 다르다는 것,
  pnpm 네이티브 의존성 차단 이슈 등.
- [07](07-work-report-input-sync-hardening.md) — client 없이 먼저 끝낼 수 있는
  서버 보강 3건: 입력 seq 응답, aimAngle 동기화, 입력 타입 검증 추가.
- [08](08-work-report-connection-smoke-test.md) — "서버가 죽지 않는다"만
  검증되던 상태에서, Colyseus 클라이언트 SDK로 접속→join→동기화까지 실제
  프로토콜로 검증하는 반복 가능한 스모크 테스트 스크립트 작성.
- [09](09-work-report-browser-playground.md) — 게임 클라이언트 없이 브라우저에서
  직접 룸에 접속해볼 수 있는 Colyseus Playground를 서버에 마운트.
- [10](10-work-report-nan-input-bug.md) — 입력 필드 타입 미검증으로 `moveX/moveY`가
  `NaN`으로 영구 오염되던 버그 수정(타입 검증 없이 범위만 clamp하던 게 원인).

## B. 렌더링 반응성/부드러움 (12~14)

서버 틱과 화면 프레임(60fps)의 주기 차이를 보간으로 메우고, 그 예산 자체(틱레이트)를
늘리고, 지터 상황의 끊김까지 잡은 3단계 개선.

- [12](12-work-report-snapshot-interpolation.md) — 20Hz로만 갱신되는 상태를
  100ms 지연 버퍼 + 선형 보간으로 부드럽게 표시(SnapshotInterpolator 최초 도입).
- [13](13-work-report-tick-rate-60hz.md) — 보간 튜닝만으로는 반응성의 진짜
  하한선(틱레이트)을 못 넘는다는 진단 후, 서버 사양을 재검토해 20Hz→60Hz로 상향.
- [14](14-work-report-extrapolation.md) — 지연 마진이 스냅샷 두 개를 딱 채우는
  수준이라 지터에 취약했던 문제를, 짧은 외삽(dead reckoning)으로 보강.

## C. 전투·몬스터·웨이브 MVP (11, 15, 16)

- [11](11-mvp-scope-proposal-combat-wave.md) — 코드 구현 전 팀 협의용 제안서.
  몬스터 4종(일반/돌진/탱커/보스), 무기 2종(근접/원거리), 코어 HP 1000, 낮
  90초+스킵투표, 웨이브 종료 시 자동부활 등을 확정.
- [15](15-work-report-combat-monster-wave.md) — 위 합의 범위를 실제 구현. 데이터
  (`monsters/weapons/waves.json`) + Flow Field + 전투 판정 + 웨이브 스케줄링 +
  서버 동기화 전 구간.
- [16](16-work-report-defeat-and-day-skip-vote.md) — 15에서 미뤄뒀던 두 항목
  (전원 다운=즉시패배, 낮 스킵 투표)을 팀 확정(만장일치 방식) 후 구현. 부활
  로직도 이때 같이 들어갔다(패배 조건이 의미 있으려면 복귀 수단이 있어야 함).

## D. 몬스터 이동/AI 정교화 (17, 19, 20, 21)

같은 "몬스터가 어색하게 움직인다" 문제를 네 차례에 걸쳐 다른 각도로 파고들었다.

- [17](17-work-report-monster-spawn-movement-refinement.md) — 군집 분리(겹침
  방지) 부재, 어그로 타겟 매틱 재계산으로 인한 떨림, 완전 무작위 스폰 지점 —
  기술명세엔 있었지만 15 구현에서 빠졌던 3가지를 보강.
- [19](19-work-report-flow-field-diagonal-weighting.md) — "이동 경로가 산봉우리
  모양으로 꺾인다" 버그. 8방향 이웃을 전부 비용 1로 취급(체비셰프 거리)하던
  것을 대각선 가중치(√2)로 수정. 부동소수점 정밀도 버그도 같이 발견해 수정.
- [20](20-work-report-monster-aggro-fov.md) — "몬스터가 어디 있든 찾아온다"는
  피드백으로 어그로 판정에 전방 120도 시야각 추가. "처음 발견"에만 걸고 이미
  추격 중인 타겟엔 안 걸어서(leash 유지) 부자연스러운 놓침을 방지.
- [21](21-work-report-monster-movement-los-steering.md) — 19를 고쳤는데도 남아있던
  "8방향 각도로만 꺾이는" 문제. 방향 계산을 비용 필드의 그라디언트(중앙차분)로
  바꾸고, 장애물 없는 구간은 Flow Field 대신 코어를 향한 진짜 연속각(직선)으로
  이동시키는 2단계 수정.

## E. 버그 수정 — 웨이브 전환 경합 (22)

- [22](22-work-report-premature-day-transition-bug.md) — "몹이 남았는데 낮으로
  바뀐다" 버그. `WaveManager.tick()`이 "살아있는 몬스터 수"를 인자로 받는
  방식에 경합이 있었다(이번 틱 스폰이 반영되기 전 스냅샷 값을 썼음) — 콜백으로
  바꿔 스폰 루프 이후 최신 값을 읽도록 수정.

## F. 디버그 도구 (23)

- [23](23-work-report-debug-jump-to-wave.md) — 5웨이브(보스전) 밸런스 테스트를
  매번 1~4웨이브를 거치지 않고 즉시 진입할 수 있는 로컬 전용(`?local=1`) 디버그
  버튼 추가. 멀티플레이(서버) 빌드에는 노출되지 않는다.

## G. 자원채집·건축 MVP (18, 24~28)

- [18](18-mvp-scope-proposal-resource-building.md) — 제안서. 자원 5종→나무/돌
  2종, 방어설비 5종→벽/울타리 2종으로 축소. 도끼(근접무기 겸용)/곡괭이(순수
  도구) 결정.
- [24](24-work-report-resource-building-mvp.md) — 서버/공유 시뮬레이션 구현.
  도구 소유권 시스템 없음(상점이 없어 검사 대상 자체가 없음), 채집은 상태
  없는 단발 액션, 건축물 점유는 셀 좌표 O(1) 인덱스(`BuildingRegistry`) 필요
  등 설계 결정과 함께.
- [25](25-work-report-resource-building-client-placeholder.md) — 에셋 없이
  도형 플레이스홀더로 클라이언트 전 구간(렌더/입력/HUD) 연결해서 실제로
  플레이 검증 가능하게 함. 셀 좌표 변환(`worldToCell`/`cellCenterWorld`)을
  공유 유틸로 추출해 서버/클라 어긋남 방지.
- [26](26-work-report-resource-node-clustering.md) — "코어 중심 고정 원 위 균등
  배치"를 "무작위 위치에 군집(숲/채석장처럼 뭉쳐서)"으로 변경 — 낮 시간에
  "예전에 봐둔 그 장소로 찾아가는" 탐색 경험을 노린 변경.
- [27](27-work-report-building-defense-bugs.md) — 버그 두 건: 코어를 건축물로
  완전히 둘러싸면 몬스터 전체가 멈추는 문제, 벽인데도 투사체가 통과하는 문제.
  고치는 과정에서 "몬스터가 raw 거리만으로 사거리 판정을 통과해 벽을 무시하고
  직접 공격하는" 더 근본적인 버그를 추가로 발견해 함께 수정.
- [28](28-work-report-player-building-collision.md) — 몬스터는 이미 건축물을
  피해 다니는데 플레이어(캐릭터)는 그냥 뚫고 지나다닐 수 있던 구멍을 메움 —
  기존 `circlesOverlap` 판정을 그대로 재사용해 플레이어-건축물 하드 충돌 추가.
