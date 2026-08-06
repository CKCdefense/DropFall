# DropFall 문서

프로젝트 문서 인덱스. 새로 합류했다면 위에서부터 순서대로 읽으면 된다.

| 문서 | 내용 |
|---|---|
| [01-game-design.md](01-game-design.md) | 게임 기획서 — 룰, 사이클, 성장, 아이템, 밸런스 방향 |
| [02-tech-spec.md](02-tech-spec.md) | 기술 명세 — 스택 선정, 프로젝트 구조, 네트워크 모델, AI |
| [03-git-convention.md](03-git-convention.md) | Git 브랜치 / 커밋 / PR 컨벤션 |
| [04-roadmap.md](04-roadmap.md) | 마일스톤, 역할 분담, 리스크 |
| [05-team-notes.md](05-team-notes.md) | **팀 공유 노트 — 작업 시작 전에 알아야 할 것** (실행 방법, 통신 규격, 함정) |
| [06-client-server-state-flow.md](06-client-server-state-flow.md) | 클라이언트 ↔ 서버 상태 통신 흐름 — 연결부터 렌더링까지 전체 시퀀스 |

### 역할 A — 서버/네트워크 작업 문서 ([backend/](backend/))

| 문서 | 내용 |
|---|---|
| [backend/05-backend-demo-plan.md](backend/05-backend-demo-plan.md) | 예선 데모(1~2주) 백엔드/서버 담당 압축 계획 |
| [backend/06-backend-setup-notes.md](backend/06-backend-setup-notes.md) | 백엔드 초기 스캐폴딩 기록 — Colyseus 0.17 API, pnpm 트러블슈팅 |
| [backend/07-work-report-input-sync-hardening.md](backend/07-work-report-input-sync-hardening.md) | 작업 보고서 — seq 응답/aimAngle 동기화/입력 검증 |
| [backend/08-work-report-connection-smoke-test.md](backend/08-work-report-connection-smoke-test.md) | 작업 보고서 — client-server 연결 실제 검증(스모크 테스트) |
| [backend/09-work-report-browser-playground.md](backend/09-work-report-browser-playground.md) | 작업 보고서 — 브라우저에서 직접 테스트(Colyseus Playground) |
| [backend/10-work-report-nan-input-bug.md](backend/10-work-report-nan-input-bug.md) | 작업 보고서 — NaN 오염 버그(입력 타입 미검증) 수정 |
| [backend/11-mvp-scope-proposal-combat-wave.md](backend/11-mvp-scope-proposal-combat-wave.md) | 제안서 — 전투·몬스터·웨이브 MVP 범위 (팀 협의용) |
| [backend/12-work-report-snapshot-interpolation.md](backend/12-work-report-snapshot-interpolation.md) | 작업 보고서 — 스냅샷 보간으로 20Hz 렌더링 끊김 보강 |
| [backend/13-work-report-tick-rate-60hz.md](backend/13-work-report-tick-rate-60hz.md) | 작업 보고서 — 서버 틱레이트 20Hz → 60Hz 상향 |
| [backend/14-work-report-extrapolation.md](backend/14-work-report-extrapolation.md) | 작업 보고서 — 보간 버퍼 부족 시 외삽(dead reckoning) 추가 |
| [backend/15-work-report-combat-monster-wave.md](backend/15-work-report-combat-monster-wave.md) | 작업 보고서 — 전투·몬스터·웨이브 MVP 구현(서버 시뮬레이션) |
| [backend/16-work-report-defeat-and-day-skip-vote.md](backend/16-work-report-defeat-and-day-skip-vote.md) | 작업 보고서 — 전원 다운 즉시패배 + 낮 스킵 투표(만장일치) 구현 |
| [backend/17-work-report-monster-spawn-movement-refinement.md](backend/17-work-report-monster-spawn-movement-refinement.md) | 작업 보고서 — 몬스터 스폰/이동 구체화(군집 분리·어그로 히스테리시스·스폰 지점 순환) |
| [backend/18-mvp-scope-proposal-resource-building.md](backend/18-mvp-scope-proposal-resource-building.md) | 제안서 — 자원채집·건축 MVP 범위(팀 협의용) |
| [backend/19-work-report-flow-field-diagonal-weighting.md](backend/19-work-report-flow-field-diagonal-weighting.md) | 작업 보고서 — Flow Field 대각선 가중치 수정(이동 경로 꺾임 버그) |
| [backend/20-work-report-monster-aggro-fov.md](backend/20-work-report-monster-aggro-fov.md) | 작업 보고서 — 몬스터 어그로 시야각(120도) 도입 |
| [backend/21-work-report-monster-movement-los-steering.md](backend/21-work-report-monster-movement-los-steering.md) | 작업 보고서 — 몬스터 이동 자연스럽게(시야선 직진 + Flow Field 우회 병행) |
| [backend/22-work-report-premature-day-transition-bug.md](backend/22-work-report-premature-day-transition-bug.md) | 작업 보고서 — 몬스터가 남았는데 낮으로 바뀌는 버그 수정(스냅샷/콜백 경합) |
| [backend/23-work-report-debug-jump-to-wave.md](backend/23-work-report-debug-jump-to-wave.md) | 작업 보고서 — 테스트용 "웨이브 5로 점프" 버튼(로컬 모드 전용) |
| [backend/24-work-report-resource-building-mvp.md](backend/24-work-report-resource-building-mvp.md) | 작업 보고서 — 자원채집·건축 MVP 구현(서버/공유 시뮬레이션) |
| [backend/25-work-report-resource-building-client-placeholder.md](backend/25-work-report-resource-building-client-placeholder.md) | 작업 보고서 — 자원채집·건축 클라이언트 연결(에셋 없이 도형 플레이스홀더) |
| [backend/26-work-report-resource-node-clustering.md](backend/26-work-report-resource-node-clustering.md) | 작업 보고서 — 자원 노드를 군집(클러스터)으로 랜덤 배치 |
| [backend/27-work-report-building-defense-bugs.md](backend/27-work-report-building-defense-bugs.md) | 작업 보고서 — 건축물 관련 버그 두 건(몬스터 정지, 투사체가 벽 통과) 수정 |
| [backend/28-work-report-player-building-collision.md](backend/28-work-report-player-building-collision.md) | 작업 보고서 — 플레이어-건축물 하드 충돌(벽/울타리 통과 방지) |
| [backend/29-work-report-collision-debug-overlay.md](backend/29-work-report-collision-debug-overlay.md) | 작업 보고서 — 플레이어 충돌 반경 디버그 테두리(C 키 토글) |
| [backend/30-work-report-boss-attack-patterns.md](backend/30-work-report-boss-attack-patterns.md) | 작업 보고서 — 보스 공격 패턴 추가(돌진 예고/광역 예고) |
| [backend/31-work-report-hitbox-fix-and-resource-rework.md](backend/31-work-report-hitbox-fix-and-resource-rework.md) | 작업 보고서 — 몬스터 히트박스 버그 수정 + 자원채집 재설계(근접 타격 + 코어 입고) + 코어 모달 통합 |
| [backend/32-work-report-muzzle-gap-miss-bug.md](backend/32-work-report-muzzle-gap-miss-bug.md) | 작업 보고서 — 근접 몬스터를 원거리 무기로 못 맞히는 버그(총구 간격 사각지대) 수정 + 몬스터 충돌 디버그 테두리 |
| [backend/33-work-report-projectile-visual-offset-bug.md](backend/33-work-report-projectile-visual-offset-bug.md) | 작업 보고서 — 총알 궤적(그림)과 실제 피격 위치가 어긋나던 렌더링 오프셋 버그 수정 |

### 역할 C — 클라이언트/렌더/UI 작업 문서 ([frontend/](frontend/))

| 문서 | 내용 |
|---|---|
| [frontend/01-client-architecture.md](frontend/01-client-architecture.md) | 클라이언트 구조 — GameConnection 추상화, Scene 구성, DOM/캔버스 경계 |
| [frontend/02-lobby-room-protocol.md](frontend/02-lobby-room-protocol.md) | 로비/방 규격 — 방 코드, 생성/참여 옵션, 입력 전송 규칙, 에러 코드 |
| [frontend/03-work-report-client-setup.md](frontend/03-work-report-client-setup.md) | 작업 보고서 — 클라이언트 초기 설정, 로비/HUD, 서버 빌드 수정 |
| [frontend/04-work-report-resolution-policy.md](frontend/04-work-report-resolution-policy.md) | 작업 보고서 — 렌더링 해상도 정책(한글 UI 가독성, 정수배 카메라 줌) |
| [frontend/05-work-report-patch-rate.md](frontend/05-work-report-patch-rate.md) | 작업 보고서 — patchRate 미설정으로 60Hz 상향분이 전달되지 않던 문제 |
| [frontend/06-ui-asset-slots.md](frontend/06-ui-asset-slots.md) | **UI 에셋 슬롯 교체 가이드** — 9-slice/이미지 플레이스홀더, 무스크롤 셸 |
| [frontend/07-asset-pipeline.md](frontend/07-asset-pipeline.md) | **에셋 파이프라인** — 원본/산출물 분리, 아틀라스 구성, 빌드 옵션 근거 |
| [frontend/08-lobby-flow.md](frontend/08-lobby-flow.md) | **대기실 흐름** — 화면 전환, 직업/준비/시작 규격, 방 코드 입력 |
| [frontend/09-work-report-ingame-modals.md](frontend/09-work-report-ingame-modals.md) | 작업 보고서 — 인게임 모달 UI 셸 4종(코어/코어관리/상점/제작) 선작업 |

## 한 줄 요약

> 낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 코어를 지키는
> 3~4인 협동 웹 생존 디펜스 게임.

## 문서 규칙

- 문서 변경도 코드와 동일하게 PR로 올린다 (`docs:` 커밋 타입).
- 결정이 바뀌면 문서를 고친다. 문서와 코드가 다르면 **문서가 틀린 것**으로 간주하고 즉시 갱신한다.
- 확정되지 않은 안은 `> TBD:` 로 표기해 남겨둔다.


코어 tier에 따라 구조물을 설치할 수 있는 범위가 넓어짐 -> 1tier(기본)값은 미정