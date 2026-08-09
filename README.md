# DropFall

낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 중앙 코어를 지키는
**협동 웹 생존 디펜스 게임**.

"떨어진다(Drop)"는 이름대로, 플레이어는 미지의 행성에 불시착한 생존자다. 중앙
코어는 구조 신호를 보내는 유일한 장치라 이것이 파괴되면 구조는 없다. 정해진 밤을
버텨내면 구조선이 도착한다.

- **장르**: 생존 · 디펜스 · 협동, 탑다운(3/4 시점 픽셀아트)
- **인원**: 2~4인 협동 (1인 플레이도 가능하도록 밸런스가 스케일링된다)
- **플랫폼**: 웹 브라우저
- **스택**: TypeScript(strict) · Phaser 3 · Colyseus · Vite · pnpm workspace

## 핵심 루프

- **낮** — 나무·돌·부품을 채집해 코어에 입고하고, 방어 시설(울타리·벽)을 짓고,
  무기·소모품을 제작하고, 코어를 강화·수리한다. AI 동료 "티모시"가 채집을 거든다.
- **밤** — 사방에서 몬스터 웨이브가 동시에 몰려온다. 2일차 밤부터는 매번 다른
  보스가 등장한다. 코어 HP가 0이 되거나 팀 전원이 쓰러지면 패배.
- **부활** — 쓰러진 팀원은 동료가 상호작용 키를 눌러 구조하거나, AID 아이템으로
  즉시, 또는 낮에 코어에서 자원을 치르고 되살릴 수 있다(유령 상태로 대기).
- 맵 곳곳의 **콜로니**(몬스터 둥지)를 정화하면 추가 보상을 얻지만, 방치하면
  몬스터가 계속 흘러나온다.

## 직업

| 직업 | 역할 | 고유 능력 |
|---|---|---|
| 병사 | 화력 — 체력이 가장 높고 성장이 빠르다 | 경험치 +20% |
| 탐색꾼 | 정찰·채집 — 가장 빠르고 가장 약하다 | 이동속도 +10% |
| 의무병 | 치유 — 팀의 생존을 책임진다 | 코어에서 붕대 제작 |
| 엔지니어 | 건축·수리 — 전선 뒤에서 방벽을 유지한다 | 수리 자원 -50% |

## 프로젝트 구조

pnpm workspace 모노레포:

```
packages/
  shared/   @dropfall/shared — 순수 TS 게임 시뮬레이션(월드·전투·웨이브·데이터).
            client/server가 이 로직을 그대로 공유한다(Phaser·Node 의존성 없음).
  server/   @dropfall/server — Colyseus 방(Room). shared/sim의 World를
            서버 권위(server-authoritative)로 구동한다.
  client/   @dropfall/client — Phaser 3 렌더링 + HUD. 서버 없이 브라우저 안에서
            shared/sim을 직접 돌리는 "혼자하기" 모드와, Colyseus로 접속하는
            온라인 모드를 같은 화면 코드로 지원한다.
```

## 시작하기

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install

pnpm dev          # 클라이언트(5173) + 서버(2567) 동시 실행
pnpm dev:client   # 클라이언트만
pnpm dev:server   # 서버만

pnpm test         # 전 패키지 유닛 테스트
pnpm typecheck    # 전 패키지 타입 검사
pnpm lint
pnpm build
```

게임은 `http://localhost:5173`에서 뜬다. 서버 없이 클라이언트만 확인하려면
`http://localhost:5173/?local=1` — `shared/sim`을 브라우저 안에서 그대로 돌린다.
그 밖의 실행 방법(2인 접속 테스트, 스모크 테스트 등)은
[팀 공유 노트](docs/05-team-notes.md) 참고.

## 문서

| 문서 | 내용 |
|---|---|
| [기획서](docs/01-game-design.md) | 룰, 낮/밤 사이클, 직업, 성장, 아이템, 밸런스 |
| [기술 명세](docs/02-tech-spec.md) | 스택 선정, 구조, 네트워크 모델, AI, 아트 파이프라인 |
| [Git 컨벤션](docs/03-git-convention.md) | 브랜치 / 커밋 / PR 규칙 |
| [로드맵](docs/04-roadmap.md) | 마일스톤, 역할 분담, 범위 조정 우선순위 |
| [팀 공유 노트](docs/05-team-notes.md) | **작업 시작 전에 알아야 할 것** — 실행 방법, 통신 규격, 함정 |
| [배포](docs/07-deployment.md) | GitHub Pages(클라) / 개인 서버 SSH(게임 서버) 설정 + CI/CD |

전체 인덱스(역할별 작업 보고서 포함)는 [docs/README.md](docs/README.md).

## 브랜치

- `main` — 시연 가능한 안정 버전
- `develop` — 개발 기본 브랜치. 모든 작업은 여기서 분기해 PR로 머지
