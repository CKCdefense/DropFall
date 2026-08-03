# DropFall 문서

프로젝트 문서 인덱스. 새로 합류했다면 위에서부터 순서대로 읽으면 된다.

| 문서 | 내용 |
|---|---|
| [01-game-design.md](01-game-design.md) | 게임 기획서 — 룰, 사이클, 성장, 아이템, 밸런스 방향 |
| [02-tech-spec.md](02-tech-spec.md) | 기술 명세 — 스택 선정, 프로젝트 구조, 네트워크 모델, AI |
| [03-git-convention.md](03-git-convention.md) | Git 브랜치 / 커밋 / PR 컨벤션 |
| [04-roadmap.md](04-roadmap.md) | 마일스톤, 역할 분담, 리스크 |
| [05-team-notes.md](05-team-notes.md) | **팀 공유 노트 — 작업 시작 전에 알아야 할 것** (실행 방법, 통신 규격, 함정) |

### 역할 A — 서버/네트워크 작업 문서 ([backend/](backend/))

| 문서 | 내용 |
|---|---|
| [backend/05-backend-demo-plan.md](backend/05-backend-demo-plan.md) | 예선 데모(1~2주) 백엔드/서버 담당 압축 계획 |
| [backend/06-backend-setup-notes.md](backend/06-backend-setup-notes.md) | 백엔드 초기 스캐폴딩 기록 — Colyseus 0.17 API, pnpm 트러블슈팅 |
| [backend/07-work-report-input-sync-hardening.md](backend/07-work-report-input-sync-hardening.md) | 작업 보고서 — seq 응답/aimAngle 동기화/입력 검증 |
| [backend/08-work-report-connection-smoke-test.md](backend/08-work-report-connection-smoke-test.md) | 작업 보고서 — client-server 연결 실제 검증(스모크 테스트) |
| [backend/09-work-report-browser-playground.md](backend/09-work-report-browser-playground.md) | 작업 보고서 — 브라우저에서 직접 테스트(Colyseus Playground) |
| [backend/10-work-report-nan-input-bug.md](backend/10-work-report-nan-input-bug.md) | 작업 보고서 — NaN 오염 버그(입력 타입 미검증) 수정 |

### 역할 C — 클라이언트/렌더/UI 작업 문서 ([frontend/](frontend/))

| 문서 | 내용 |
|---|---|
| [frontend/01-client-architecture.md](frontend/01-client-architecture.md) | 클라이언트 구조 — GameConnection 추상화, Scene 구성, DOM/캔버스 경계 |
| [frontend/02-lobby-room-protocol.md](frontend/02-lobby-room-protocol.md) | 로비/방 규격 — 방 코드, 생성/참여 옵션, 입력 전송 규칙, 에러 코드 |
| [frontend/03-work-report-client-setup.md](frontend/03-work-report-client-setup.md) | 작업 보고서 — 클라이언트 초기 설정, 로비/HUD, 서버 빌드 수정 |
| [frontend/04-work-report-resolution-policy.md](frontend/04-work-report-resolution-policy.md) | 작업 보고서 — 렌더링 해상도 정책(한글 UI 가독성, 정수배 카메라 줌) |

## 한 줄 요약

> 낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 코어를 지키는
> 3~4인 협동 웹 생존 디펜스 게임.

## 문서 규칙

- 문서 변경도 코드와 동일하게 PR로 올린다 (`docs:` 커밋 타입).
- 결정이 바뀌면 문서를 고친다. 문서와 코드가 다르면 **문서가 틀린 것**으로 간주하고 즉시 갱신한다.
- 확정되지 않은 안은 `> TBD:` 로 표기해 남겨둔다.
