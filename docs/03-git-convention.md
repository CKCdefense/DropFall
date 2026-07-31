# Git 컨벤션

3인 팀 기준. **규칙은 지킬 수 있을 만큼만** 둔다. 아래가 전부다.

---

## 1. 브랜치 전략

Git Flow는 3인 프로젝트에 과하다. **단순화한 GitHub Flow**를 쓴다.

```
main        ← 시연 가능한 안정 버전만. 직접 커밋 금지
 └ develop  ← 기본 통합 브랜치. 모든 작업 브랜치가 여기서 갈라지고 여기로 머지
    ├ feat/player-movement
    ├ feat/flow-field-ai
    ├ fix/reload-cancel
    └ docs/tech-spec
```

| 브랜치 | 규칙 |
|---|---|
| `main` | 배포/시연용. `develop`에서만 머지. 항상 실행 가능해야 함 |
| `develop` | 개발 기본 브랜치. PR로만 머지 |
| `feat/*` | 기능 개발 |
| `fix/*` | 버그 수정 |
| `refactor/*` | 동작 변화 없는 구조 개선 |
| `docs/*` | 문서 |
| `chore/*` | 빌드/설정/의존성 |

### 브랜치 이름 규칙
```
<type>/<kebab-case-요약>
```
- 예: `feat/wave-spawner`, `fix/turret-target-crash`, `chore/eslint-setup`
- 한글 금지, 소문자 + 하이픈만
- 이슈 번호가 있으면 뒤에: `feat/wave-spawner-#12`

### 작업 흐름
```bash
git checkout develop
git pull origin develop
git checkout -b feat/wave-spawner
# ... 작업 ...
git push -u origin feat/wave-spawner
# GitHub에서 develop 대상 PR 생성
```

**작업 브랜치는 오래 살려두지 않는다.** 3일 이상 가면 충돌 지옥이다.
크면 쪼개고, 매일 `develop`을 받아 rebase 한다.

```bash
git fetch origin
git rebase origin/develop
```

---

## 2. 커밋 컨벤션

**Conventional Commits** 를 따른다.

```
<type>(<scope>): <제목>

<본문 - 선택>

<푸터 - 선택>
```

### 예시
```
feat(sim): 웨이브 스포너 구현

웨이브 테이블(waves.json)을 읽어 스폰 지점별로 몬스터를 생성한다.
인원수 스케일링 계수 적용.

Closes #12
```
```
fix(client): 재장전 중 무기 교체 시 탄약이 복제되는 문제 수정
```
```
docs: 기술 명세에 Flow Field 설계 추가
```

### type

| type | 용도 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변화 없는 코드 개선 |
| `perf` | 성능 개선 |
| `style` | 포맷팅, 세미콜론 등 (로직 변화 없음) |
| `test` | 테스트 추가/수정 |
| `docs` | 문서 |
| `chore` | 빌드, 설정, 의존성, 스크립트 |
| `asset` | 스프라이트/맵/사운드 등 리소스 추가·교체 |

### scope (선택, 권장)

`shared` / `sim` / `server` / `client` / `net` / `ui` / `render` / `data` / `build`

### 제목 규칙
- **한국어로 쓴다** (팀 전원 한국어. 영어 강요하면 커밋 메시지 품질만 나빠진다)
- 50자 이내, 마침표 없음
- 명령형보다 **"무엇을 했는지"** 가 명확하면 된다: `~ 구현`, `~ 수정`, `~ 추가`
- 제목만으로 무슨 변경인지 알 수 있어야 한다
  - ❌ `수정`, `작업중`, `ㅇㅇ`, `merge`
  - ⭕ `feat(ui): 인벤토리 슬롯 드래그 이동 구현`

### 본문
- 왜 그렇게 했는지를 쓴다. **무엇을 했는지는 diff를 보면 안다**
- 72자에서 줄바꿈

### 푸터
- `Closes #12`, `Refs #7`
- 파괴적 변경: `BREAKING CHANGE: 저장 데이터 포맷 변경`

---

## 3. Pull Request

### 규칙
- **`develop`으로의 모든 머지는 PR을 거친다.** 직접 push 금지
- 리뷰어 **최소 1명** 승인 후 머지
- 리뷰는 **24시간 내** 응답 (공모전 일정상 이게 데드라인)
- 본인이 자기 PR을 머지한다 (승인 받은 후)

### PR 제목
커밋과 동일한 형식: `feat(sim): 웨이브 스포너 구현`

### PR 템플릿

```markdown
## 무엇을
<!-- 이 PR이 하는 일 1~3줄 -->

## 왜
<!-- 배경, 관련 이슈 -->
Closes #

## 어떻게
<!-- 주요 구현 방식, 리뷰어가 봐야 할 포인트 -->

## 확인
- [ ] 로컬에서 실행 확인
- [ ] 멀티(2인 이상) 동작 확인 *(네트워크 관련 시)*
- [ ] `pnpm lint` / `pnpm test` 통과
- [ ] 문서 갱신 필요 시 반영

## 스크린샷 / 영상
<!-- 렌더링·UI 변경 시 필수 -->
```

### 머지 방식
- **Squash and merge** 를 기본으로 한다 → `develop` 히스토리가 PR 단위로 깔끔해짐
- 이때 squash 커밋 제목은 PR 제목(Conventional Commits 형식)으로 정리
- `develop` → `main` 은 **Merge commit** (릴리스 지점을 히스토리에 남긴다)

---

## 4. 코드 리뷰 가이드

3인 팀이라 리뷰가 병목이 되면 안 된다. **빠르고 가볍게.**

**리뷰어가 볼 것**
1. `shared/sim`이 Phaser/DOM/Node를 import 하지 않는가 (**최우선**)
2. 밸런스 수치가 코드에 하드코딩되지 않았는가
3. 명백한 버그, 네트워크 동기화 누락
4. 이름이 이해되는가

**리뷰어가 보지 말 것**
- 취향 차이의 코드 스타일 (Prettier가 처리한다)
- "나라면 이렇게 짰을 텐데" 수준의 재작성 요구

**코멘트 접두어로 강도를 표시한다**
- `[must]` 고쳐야 머지 가능
- `[should]` 고치는 게 좋음, 판단은 작성자
- `[nit]` 사소함, 무시해도 됨
- `[q]` 단순 질문

---

## 5. 충돌 / 에셋 관리

### 바이너리 충돌 방지
PNG, `.aseprite`, `.tmj`는 **머지가 불가능하다.** 다음을 지킨다.
- 같은 에셋 파일을 두 명이 동시에 수정하지 않는다 (작업 전 팀 채널에 공유)
- 아틀라스 PNG/JSON은 **한 명만** 리빌드해서 커밋 (기본: 아트 담당)
- 맵 파일도 담당자를 1명 고정

### `.gitignore` 필수 항목
```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
```

### 커밋하는 것 / 안 하는 것
| 커밋함 | 커밋 안 함 |
|---|---|
| `assets/**` 원본 (.aseprite, .tmx) | `node_modules/`, `dist/` |
| 생성된 아틀라스 PNG/JSON | `.env`, 로컬 설정 |
| `pnpm-lock.yaml` | IDE 개인 설정 |

> 아틀라스 산출물을 커밋하는 이유: 팀원이 Aseprite CLI 없이도 클론 즉시 실행 가능해야 함.

---

## 6. 이슈 / 태스크 관리

- GitHub Issues + Projects(칸반) 사용
- 라벨: `feat` `fix` `docs` `art` `balance` `blocked` / 우선순위 `P0`(시연 필수) `P1` `P2`
- 이슈 제목도 무슨 일인지 알 수 있게: `[sim] 웨이브 스포너 구현`
- **P0가 아닌 이슈는 데모 이후로 미룬다.** 공모전은 완성도 싸움이다

---

## 7. 릴리스

- `develop` → `main` 머지 시 태그: `v0.1.0`, `v0.2.0`
- 시연 직전 빌드는 반드시 태그를 찍는다. **시연 당일 급한 수정 금지**
- `main`은 항상 실행 가능해야 한다. 심사위원이 언제 눌러볼지 모른다

---

## 8. 자주 쓰는 명령

```bash
# 최신 develop 반영
git fetch origin && git rebase origin/develop

# 마지막 커밋 메시지 수정 (push 전에만!)
git commit --amend

# 작업 임시 저장
git stash && git stash pop

# 특정 커밋만 가져오기
git cherry-pick <hash>

# 실수로 develop에서 작업했을 때 → 브랜치로 옮기기
git switch -c feat/my-work
```

> **push 한 커밋은 rebase/amend 하지 않는다.** 공유 브랜치에서는 절대 금지.
> 자기 작업 브랜치에서만 허용.
