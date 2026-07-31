# DropFall

낮에는 자원을 모아 거점을 짓고, 밤에는 몰려오는 몬스터로부터 중앙 코어를 지키는
**3~4인 협동 웹 생존 디펜스 게임**.

- 장르: 생존 / 디펜스 · 멀티 협동 · 탑다운(3/4 시점 픽셀아트)
- 플랫폼: 웹 브라우저
- 스택: TypeScript · Phaser 3 · Colyseus · Vite · pnpm workspace

## 문서

| 문서 | 내용 |
|---|---|
| [기획서](docs/01-game-design.md) | 룰, 낮/밤 사이클, 직업, 성장, 아이템, 밸런스 |
| [기술 명세](docs/02-tech-spec.md) | 스택 선정, 구조, 네트워크 모델, AI, 아트 파이프라인 |
| [Git 컨벤션](docs/03-git-convention.md) | 브랜치 / 커밋 / PR 규칙 |
| [로드맵](docs/04-roadmap.md) | 마일스톤, 역할 분담, 범위 조정 우선순위 |

전체 인덱스는 [docs/README.md](docs/README.md).

## 개발

> 아직 스캐폴딩 전이다. W1 완료 후 아래 명령이 동작한다.

```bash
pnpm install
pnpm dev     # 클라이언트(5173) + 서버(2567) 동시 실행
pnpm test
```

## 브랜치

- `main` — 시연 가능한 안정 버전
- `develop` — 개발 기본 브랜치. 모든 작업은 여기서 분기해 PR로 머지
