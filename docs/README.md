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
| [backend/48-work-report-cicd-deployment-pipeline.md](backend/48-work-report-cicd-deployment-pipeline.md) | 작업 보고서 — CI/CD 구축(GitHub Pages + 개인 서버 SSH), Node/corepack/sudoers/SSH키/Tailscale Funnel 전환 등 실서버 적용 과정 |
| [backend/49-work-report-core-blind-zone-and-hit-alert.md](backend/49-work-report-core-blind-zone-and-hit-alert.md) | 작업 보고서 — 코어 북쪽 사각지대 반투명 처리(12시 방향 공격 안 보이던 버그) + 피격 알림(월드+HUD) |
| [backend/50-work-report-downed-player-action-lockout.md](backend/50-work-report-downed-player-action-lockout.md) | 작업 보고서 — 다운된(hp 0) 플레이어가 이동 말고는 아무 동작도 못 하게 막음 |
| [backend/51-work-report-companion-core-stuck-movement.md](backend/51-work-report-companion-core-stuck-movement.md) | 작업 보고서 — 티모시가 코어에 막혀 영원히 멈추는 이동 버그(접선 미끄러짐+탈출 점프 이식) |
| [backend/55-work-report-player-client-prediction.md](backend/55-work-report-player-client-prediction.md) | 작업 보고서 — 내 캐릭터 클라이언트 예측+재조정(멀티플레이 텔레포트/끊김 원인 분석 및 해결) |
| [backend/56-work-report-resource-rebuild.md](backend/56-work-report-resource-rebuild.md) | 작업 보고서 — 자원 시스템 리빌딩(자원·에너지 게이지, 코어 충전, 돈 제거, 제작 시간, 해머 수리, 레벨업/SP) |
| [backend/57-work-report-speed-craft-output-charge-tier.md](backend/57-work-report-speed-craft-output-charge-tier.md) | 작업 보고서 — 이동속도 75%, 제작 결과 대기 칸(드래그 회수), 코어 티어별 충전 칸·쉬프트 클릭·거절 표시 |
| [backend/58-work-report-golem-slam-alignment.md](backend/58-work-report-golem-slam-alignment.md) | 작업 보고서 — 몬스터 그림 가로 중심 보정(골렘 광역 찍기 정렬), 동작별 재생속도 지정 |
| [backend/59-work-report-cinematics-and-boss-warning.md](backend/59-work-report-cinematics-and-boss-warning.md) | 작업 보고서 — 시작 암전·DAY N·보스 경고(심 구간 추가)·CLEAR 연출 |
| [backend/60-work-report-melee-pose-and-building-destruction.md](backend/60-work-report-melee-pose-and-building-destruction.md) | 작업 보고서 — 근접 무기 사선 자세·사거리 조정, 건축모드 제거, 근접 타격으로 건축물 파괴(해머는 아이템 회수) |
| [backend/61-work-report-session-handoff-verification.md](backend/61-work-report-session-handoff-verification.md) | 작업 보고서 — 세션 인계 확인(56↔55 충돌 없음), PATCH_RATE 문서 정합성 정리 + 60→50 실험, 공격 스탯 fireRate 정규화(피드백 #1) |
| [backend/62-work-report-colony-trickle-spawn.md](backend/62-work-report-colony-trickle-spawn.md) | 작업 보고서 — 콜로니 저장분 소진 후 트리클 스폰 추가(아침 파밍 가능하게, 피드백 #3) |
| [backend/63-work-report-wave-player-scaling.md](backend/63-work-report-wave-player-scaling.md) | 작업 보고서 — 몬스터 웨이브 인원수 스케일링 신규 구현(기본값 3배 + 인원당 +100%, 피드백 #2) |
| [backend/64-work-report-terrain-resource-placement.md](backend/64-work-report-terrain-resource-placement.md) | 작업 보고서 — 자원 노드를 클러스터 배치에서 지형 기반 확률 배치로 전면 교체, 인원수 스케일링(피드백 #4) |
| [backend/65-work-report-revive-system.md](backend/65-work-report-revive-system.md) | 작업 보고서 — 부활 시스템(쓰러짐/유령, 혼자하기 10초 자동 부활, 동료 구조 5초, AID 즉시 부활, 낮에 코어에서 에너지로 유령 부활) |
| [backend/66-work-report-wave-spawn-cadence.md](backend/66-work-report-wave-spawn-cadence.md) | 작업 보고서 — 웨이브 무리 크기를 총원과 같은 배율로 스케일링 + 스폰 지점 전체 동시 분산(사방에서 동시 공격) |
| [backend/67-work-report-colony-ranged-engagement-bug.md](backend/67-work-report-colony-ranged-engagement-bug.md) | 작업 보고서 — 원거리 무기로 콜로니를 farm하면 트리클 없이 즉시 정화되던 버그 수정(engagedTimer 유예 추가) |
| [backend/68-design-proposal-bullet-pierce.md](backend/68-design-proposal-bullet-pierce.md) | 구현 기획서 — 무기별 총알 관통 횟수 도입, 근접 광역 vs 원거리 탄약제약 트레이드오프 분석(→ backend/69에서 구현) |
| [backend/69-work-report-bullet-pierce-and-reload.md](backend/69-work-report-bullet-pierce-and-reload.md) | 작업 보고서 — 무기별 총알 관통 횟수 구현(backend/68 대안 C) + 전 원거리 무기 재장전 절반 단축 |
| [backend/70-work-report-craft-output-stacking.md](backend/70-work-report-craft-output-stacking.md) | 작업 보고서 — 제작 결과 칸에 같은 물건 쌓기(상한 100), 되돌리기 경로에서 초과분이 사라지던 버그 수정 |
| [backend/71-work-report-drop-rate-monster-count-ranged-value.md](backend/71-work-report-drop-rate-monster-count-ranged-value.md) | 작업 보고서 — 부품 드랍률 50%+개수 증가, 몬스터 수 하향(baseMultiplier 3→2), 원거리 무기 가성비 2차 조정(rifle/sniper_rifle/샷건 2종) |
| [backend/72-work-report-job-balance.md](backend/72-work-report-job-balance.md) | 작업 보고서 — 직업별 고유 능력(경험치·이동속도·수리비·전용 레시피)과 전용 시작 장비, 스태미나 2.5초, 토마호크 채집 겸용화 |
| [backend/73-work-report-floor-spikes.md](backend/73-work-report-floor-spikes.md) | 작업 보고서 — 바닥 스파이크 3티어(막지 않고 감속 20/30/40%, 보스 제외, 체류 마모), Lua 생성 픽셀아트 |
| [backend/72-work-report-pickup-key-and-quickslot-click.md](backend/72-work-report-pickup-key-and-quickslot-click.md) | 작업 보고서 — 줍기 전용 키(스페이스) 추가, 퀵슬롯 좌클릭으로 무기 장착(SlotDrag.onClickSelect) |
| [backend/71-work-report-monster-anim-multiplayer-bug.md](backend/71-work-report-monster-anim-multiplayer-bug.md) | 작업 보고서 — 멀티에서만 몬스터 공격 모션·방향 전환이 안 되던 버그(스키마 필드가 스폰 시점에만 대입됨) 수정 + 회귀 테스트 |
| [backend/73-work-report-slot-label-render-staleness-bug.md](backend/73-work-report-slot-label-render-staleness-bug.md) | 작업 보고서 — 퀵무브/충전 칸 라벨이 화면에 고착되는 Phaser Text 렌더링 버그, Playwright 실측 재현으로 원인 특정·수정 |
| [backend/74-work-report-core-repair-and-ghost-resource-revive.md](backend/74-work-report-core-repair-and-ghost-resource-revive.md) | 작업 보고서 — 코어 수리를 상점 소모품에서 코어 메뉴 버튼으로 전환(부분 수리), 유령 부활 통화를 에너지→자원으로 변경 + 부활 UI 신설 |
| [backend/75-work-report-audio-system.md](backend/75-work-report-audio-system.md) | 작업 보고서 — 게임 사운드 시스템 신설(발소리·전투·몬스터·부활 효과음 + 국면별 배경음악 지연 로드·교차페이드), Playwright 실측 검증 |
| [backend/76-work-report-monster-core-pass-through-bug.md](backend/76-work-report-monster-core-pass-through-bug.md) | 작업 보고서 — 플레이어를 쫓는 몬스터가 코어를 뚫고 반대편으로 통과하던 버그 수정(isBlockedForMonster에 코어 추가), 회귀 테스트로 재현·검증 |

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
| [frontend/13-work-report-core-hub-tabs.md](frontend/13-work-report-core-hub-tabs.md) | 작업 보고서 — 코어 창을 상단 탭 구조로 재설계(9-slice 돌 프레임, 그리드 레이아웃) |
| [frontend/14-work-report-bottom-bar-and-character.md](frontend/14-work-report-bottom-bar-and-character.md) | 작업 보고서 — 하단 퀵슬롯 확대와 체력·스태미나 막대 통합, 캐릭터 정보 창 |
| [frontend/15-work-report-consumable-fx-and-melee-scale.md](frontend/15-work-report-consumable-fx-and-melee-scale.md) | 작업 보고서 — 소모품 사용 이펙트(회복/버프/스탯) 연결, 근접 무기 일괄 축소, 휘두르기 이펙트 좌우 반전 수정 |
| [frontend/16-work-report-solo-setup-and-companion-toggle.md](frontend/16-work-report-solo-setup-and-companion-toggle.md) | 작업 보고서 — 혼자하기 직업 선택 모달, 멀티·싱글 티모시 켜고 끄기 |
| [frontend/17-work-report-controls-and-prompts.md](frontend/17-work-report-controls-and-prompts.md) | 작업 보고서 — 걷기 모션 복구, 소모품 우클릭·휠 슬롯 전환, 코어 E 키 안내, 제작 진행 화살표 |
| [frontend/18-work-report-attack-fx-gating.md](frontend/18-work-report-attack-fx-gating.md) | 작업 보고서 — 연타 시 쿨다운을 무시하고 나오던 공격 연출 수정(재장전·빈 탄창 포함) |
| [frontend/19-work-report-fx-alignment-and-title-weight.md](frontend/19-work-report-fx-alignment-and-title-weight.md) | 작업 보고서 — 소모품 이펙트 발밑 정렬, 레벨업 연출 미니멀화, 중앙 문구 볼드·확대 |
| [frontend/20-work-report-downed-visuals.md](frontend/20-work-report-downed-visuals.md) | 작업 보고서 — 쓰러진 캐릭터를 발밑 축으로 눕히고, 하단 바 위에 HELP!·부활/유령 카운터·구조 게이지 표시 |
| [frontend/21-work-report-waiting-room-redesign.md](frontend/21-work-report-waiting-room-redesign.md) | 작업 보고서 — 대기실을 와이어프레임(강하 준비)대로 재구성, 직업 아이콘·행성·배경 에셋 연결, 대기실에서 티모시 on/off |

## 한 줄 요약

> 낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 코어를 지키는
> 3~4인 협동 웹 생존 디펜스 게임.

## 문서 규칙

- 문서 변경도 코드와 동일하게 PR로 올린다 (`docs:` 커밋 타입).
- 결정이 바뀌면 문서를 고친다. 문서와 코드가 다르면 **문서가 틀린 것**으로 간주하고 즉시 갱신한다.
- 확정되지 않은 안은 `> TBD:` 로 표기해 남겨둔다.


코어 tier에 따라 구조물을 설치할 수 있는 범위가 넓어짐 -> 1tier(기본)값은 미정