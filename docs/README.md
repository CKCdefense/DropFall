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
| [07-deployment.md](07-deployment.md) | 배포 — GitHub Pages(클라)/개인 서버 SSH(게임 서버) 최초 설정 + CI/CD 워크플로 |

### 역할 A — 서버/네트워크 작업 문서 ([backend/](backend/))

| 문서 | 내용 |
|---|---|
| [backend/00-summary-05-28.md](backend/00-summary-05-28.md) | **요약** — 05~28 24건(서버 초기 구축 → 렌더링 보간/틱레이트 → 전투·웨이브 MVP → 몬스터 AI 정교화 → 자원채집·건축 MVP)을 주제별로 묶어 정리. 개별 문서는 아래 표 대신 이 요약의 링크로 찾아갈 것 |
| [backend/29-work-report-collision-debug-overlay.md](backend/29-work-report-collision-debug-overlay.md) | 작업 보고서 — 플레이어 충돌 반경 디버그 테두리(C 키 토글) |
| [backend/30-work-report-boss-attack-patterns.md](backend/30-work-report-boss-attack-patterns.md) | 작업 보고서 — 보스 공격 패턴 추가(돌진 예고/광역 예고) |
| [backend/31-work-report-hitbox-fix-and-resource-rework.md](backend/31-work-report-hitbox-fix-and-resource-rework.md) | 작업 보고서 — 몬스터 히트박스 버그 수정 + 자원채집 재설계(근접 타격 + 코어 입고) + 코어 모달 통합 |
| [backend/32-work-report-muzzle-gap-miss-bug.md](backend/32-work-report-muzzle-gap-miss-bug.md) | 작업 보고서 — 근접 몬스터를 원거리 무기로 못 맞히는 버그(총구 간격 사각지대) 수정 + 몬스터 충돌 디버그 테두리 |
| [backend/33-work-report-projectile-visual-offset-bug.md](backend/33-work-report-projectile-visual-offset-bug.md) | 작업 보고서 — 총알 궤적(그림)과 실제 피격 위치가 어긋나던 렌더링 오프셋 버그 수정 (이후 backend/34로 해법 대체됨) |
| [backend/34-work-report-develop-merge-combat-accuracy.md](backend/34-work-report-develop-merge-combat-accuracy.md) | 작업 보고서 — client develop 병합(연사속도·히트박스·조준 정합성 FixedStep 수정 + 지형 시스템), 겹치는 수정사항 해결 과정 |
| [backend/35-work-report-monster-colony.md](backend/35-work-report-monster-colony.md) | 작업 보고서 — 몬스터 콜로니(낮에도 스폰·채널링 파괴·엄호 협동) 도입, 몬스터 스폰 반경을 맵 가장자리로 조정 |
| [backend/36-work-report-camera-bounds-stale-constant-bug.md](backend/36-work-report-camera-bounds-stale-constant-bug.md) | 작업 보고서 — 카메라 스크롤 범위가 실제 맵보다 작게 방치돼 콜로니에 갈 수 없던 버그 수정 |
| [backend/37-work-report-monster-kill-drops.md](backend/37-work-report-monster-kill-drops.md) | 작업 보고서 — 몬스터 처치 보상(흔한 자원 "파편" 개인 휴대 + 희귀 자원 "에너지" 팀 공유, 콜로니와 통합) 추가 |
| [backend/38-work-report-core-upgrade-static-collision.md](backend/38-work-report-core-upgrade-static-collision.md) | 작업 보고서 — 코어 업그레이드(에너지 소비, 체력·건설반경·해금 3단계) + 코어/자원/콜로니 하드 충돌(몹·플레이어·투사체 통과 불가) |
| [backend/39-work-report-resource-respawn-relocation.md](backend/39-work-report-resource-respawn-relocation.md) | 작업 보고서 — 자원 노드 리스폰 재배치(같은 군집 안 새 위치, 플레이어 비겹침) + 몬스터 충돌 반경 누락 버그 수정 + 자원 스폰 최소거리 확대 |
| [backend/40-work-report-monster-obstacle-sliding.md](backend/40-work-report-monster-obstacle-sliding.md) | 작업 보고서 — 몬스터가 자원 노드/콜로니에 막히면 영원히 멈추던 버그를 축 슬라이딩+접선 미끄러짐으로 수정, 콜로니 스폰 위치를 중심이 아닌 경계 밖으로 변경 |
| [backend/41-work-report-colony-player-scaled-placement.md](backend/41-work-report-colony-player-scaled-placement.md) | 작업 보고서 — 콜로니를 접속 인원수만큼(사분면당 1개, 최소 간격 보장) 무작위 배치하도록 변경 |
| [backend/42-work-report-monster-stuck-escape-and-extrapolation-clamp.md](backend/42-work-report-monster-stuck-escape-and-extrapolation-clamp.md) | 작업 보고서 — 몬스터가 촘촘한 자원 군집에 완전히 갇히면 탈출 점프, 클라이언트 외삽이 장애물을 인지 못 해 뚫고 지나가 보이던 렌더링 버그 수정 |
| [backend/43-work-report-object-fade-removal-and-demolish.md](backend/43-work-report-object-fade-removal-and-demolish.md) | 작업 보고서 — 고갈/파괴된 오브젝트 반투명 잔상 제거(완전히 숨김) + 파괴된 콜로니 하드 충돌 해제 + 건설모드 철거 기능(환급 없음) |
| [backend/44-work-report-shift-click-quick-move.md](backend/44-work-report-shift-click-quick-move.md) | 작업 보고서 — 쉬프트 클릭으로 창고 ↔ 인벤토리 빠른 이동(목적지 칸 자동 선택) |
| [backend/45-work-report-monster-spatial-grid.md](backend/45-work-report-monster-spatial-grid.md) | 작업 보고서 — 몬스터 공간 분할 격자(SpatialGrid) 도입, 군집 분리/투사체 충돌 O(n²) → O(n) |
| [backend/46-work-report-resource-node-position-sync.md](backend/46-work-report-resource-node-position-sync.md) | 작업 보고서 — 자원 노드 리스폰 시 서버가 새 좌표를 클라이언트에 재동기화 안 하던 버그 |
| [backend/47-work-report-patch-rate-bandwidth.md](backend/47-work-report-patch-rate-bandwidth.md) | 작업 보고서 — PATCH_RATE 60→20Hz, 2인 이상 실접속 렉의 원인(대역폭이 인원수에 비례) |

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
| [frontend/10-dev-mode.md](frontend/10-dev-mode.md) | **개발 모드** — 개발자 콘솔(`` ` ``)과 테스트 모드 아이템 도감(F9), 커맨드 목록, 켜는 방법 |
| [frontend/11-work-report-quit-confirm-modal.md](frontend/11-work-report-quit-confirm-modal.md) | 작업 보고서 — ESC 나가기에 확인창(나가기/취소) 추가 |
| [frontend/12-work-report-css-asset-double-path.md](frontend/12-work-report-css-asset-double-path.md) | 작업 보고서 — GitHub Pages 배포 시 UI 이미지 전부 404(CSS 커스텀 프로퍼티 url() 이중 경로 해석 버그) |

## 한 줄 요약

> 낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 코어를 지키는
> 3~4인 협동 웹 생존 디펜스 게임.

## 문서 규칙

- 문서 변경도 코드와 동일하게 PR로 올린다 (`docs:` 커밋 타입).
- 결정이 바뀌면 문서를 고친다. 문서와 코드가 다르면 **문서가 틀린 것**으로 간주하고 즉시 갱신한다.
- 확정되지 않은 안은 `> TBD:` 로 표기해 남겨둔다.


코어 tier에 따라 구조물을 설치할 수 있는 범위가 넓어짐 -> 1tier(기본)값은 미정