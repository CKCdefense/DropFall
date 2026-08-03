# UI 에셋 슬롯 — 플레이스홀더 교체 가이드

> 랜딩/로비 화면은 레이아웃만 확정하고 **시각 요소는 전부 플레이스홀더** 상태다.
> 픽셀 에셋이 준비되면 이 문서대로 값만 바꾸면 되고, **마크업과 레이아웃은 건드리지 않는다.**

## 1. 왜 이렇게 만들었나

에셋을 기다리며 UI 작업을 멈추면 일정이 밀리고, 나중에 에셋을 끼워 넣으며 레이아웃을
다시 잡으면 두 번 일한다. 그래서 **에셋이 차지할 공간을 지금 정확히 확보해 두고**,
그 자리를 알아볼 수 있는 플레이스홀더로 채웠다.

핵심은 CSS `border-image`의 성질이다:

> `border-image-source: none` 이면 브라우저는 이를 무시하고 일반 `border`를 그린다.
> `url(...)` 이 들어오는 순간 같은 두께 자리에 9-slice가 대신 그려진다.

즉 **테두리 두께(= 9-slice가 먹을 공간)를 미리 잡아두고 소스만 나중에 꽂는** 구조다.

## 2. 파일 구성

```
packages/client/src/ui/
├─ styles.css              진입점 (아래 4개를 import)
└─ styles/
   ├─ tokens.css           ★ 팔레트 + 에셋 교체 지점. 대부분의 작업은 여기서 끝난다
   ├─ base.css             앱 셸 — 스크롤 차단, 뷰포트 고정
   ├─ components.css       9-slice 프레임/버튼/입력, 이미지 슬롯
   └─ lobby.css            랜딩·목록·생성 화면 레이아웃
```

## 3. 9-slice 교체 (프레임 / 버튼 / 입력)

`tokens.css`의 값만 바꾸면 된다.

```css
:root {
  --asset-frame: url('/assets/ui/frame.png');
  --asset-frame-slice: 6;   /* 원본 이미지의 모서리 크기(px) */
  --px: 3;                  /* 픽셀 에셋 배율. 정수배만 */
}
```

- 실제 테두리 두께 = `slice × px`. 위 예시면 `6 × 3 = 18px`
- **`slice` 값을 바꾸면 레이아웃이 밀린다.** 원본 에셋을 현재 값(프레임 6 / 버튼 4 / 입력 3)에
  맞춰 그리는 편이 안전하다. 부득이 바꿔야 하면 화면을 다시 확인할 것
- `--px`는 정수만 쓴다. 소수배는 픽셀이 들쭉날쭉해진다 ([frontend/04](04-work-report-resolution-policy.md))

**플레이스홀더 표현 끄기**: 에셋을 넣은 요소에는 `data-asset` 속성을 붙인다.
`.frame:not([data-asset])` 규칙이 임시 외곽선/그림자를 그리고 있어서, 이걸 꺼야 에셋만 보인다.

```ts
el('div', { class: 'frame panel', 'data-asset': '' }, [...])
```

| 슬롯 | 원본 | slice | 배율 | 적용 클래스 |
|---|---|---|---|---|
| 모달 프레임 | `title_modal.png` 64×64 | 16 | `--modal-px` 2 | `.modal` |
| 버튼 | `title_button.png` 64×64 | 15 | `--button-px` 1 | `.btn` |
| 버튼(호버) | `title_button_hover.png` | 15 | — | `.btn:hover` |
| 입력창 | `input.png` 64×64 | 14 | `--input-px` 1 | `.field` |
| 입력창(호버/포커스) | `input_hover.png` | 14 | — | `.field:hover, :focus-within` |
| 창 프레임(미사용) | — | 6 | `--px` 3 | `.frame` |

**slice × 배율 = 실제 테두리 두께.** slice가 큰 에셋(14~16)에 전역 `--px`(3)를 그대로 쓰면
테두리가 45px가 넘어 버튼 안에 글자가 안 들어간다. 그래서 컴포넌트별 배율 토큰을 따로 뒀다.

> `.btn-small` / `.btn-ghost` / `.btn-link`는 9-slice를 쓰지 않는다 — 높이가 32~44px이라
> 15px 테두리가 위아래로 들어가면 내용이 남지 않는다. 작은 버튼용 에셋이 따로 필요하다.

**호버 에셋이 없으면** 기본 에셋을 그대로 쓴다(`assets.ts`의 `HOVER_FALLBACKS`).
이게 없으면 hover 시 `border-image-source`가 `none`이 되어 테두리가 사라진다.


## 4. 이미지 에셋 교체 (로고 / 배경 등)

**파일을 정해진 경로에 넣고 `pnpm build:atlas`만 실행하면 된다. 코드 수정은 필요 없다.**

| 에셋 | 원본 경로 | 파일명 |
|---|---|---|
| 타이틀 로고 | `assets/ui/logo/` | `logo_title.png` |
| 랜딩 배경 | `assets/ui/backgrounds/` | `bg_landing.png` |

앱 시작 시 [`loadImageAssets()`](../../packages/client/src/ui/assets.ts)가 각 에셋의 존재를
확인해서, **있으면** CSS 변수에 넣고 **없으면** 기존 플레이스홀더를 그대로 쓴다.
에셋이 하나씩 들어오는 단계라 이렇게 해두면 중간 상태에서도 화면이 깨지지 않는다.

```
파일 있음 → --asset-logo에 url 주입, .placeholder 클래스 제거
파일 없음 → 점선 상자 + 'DropFall' 텍스트 (지금까지의 모습)
```

> **경로를 CSS에 직접 쓰지 않는 이유**: `public/` 파일은 Vite가 경로를 재작성해주지 않는다.
> CSS에 `url('/assets/...')`처럼 절대경로를 쓰면 GitHub Pages 하위경로(`/DropFall/`)에서 깨진다.
> `import.meta.env.BASE_URL`을 붙여 런타임에 주입하면 Pages와 홈서버 양쪽에서 같은 빌드가 동작한다.

### 배경 이미지 주의점

`background-size: cover`라 **이미지 비율과 화면 비율이 다르면 가장자리가 잘린다.**
중요한 요소는 중앙 쪽에 배치할 것. 16:9로 그리면 대부분의 화면에서 잘림이 최소가 된다.

배경이 있을 때만 `<html>`에 `has-landing-bg` 클래스가 붙고, 글자 가독성을 위한 어두운 막
(`rgba(10,12,17,0.5)`)이 깔린다. 배경이 밝거나 대비가 부족하면 이 값을 조정한다
([lobby.css](../../packages/client/src/ui/styles/lobby.css)).

### 새 이미지 슬롯을 추가하려면

1. `assets.ts`의 `IMAGE_ASSETS`에 `{ cssVar, path }` 추가
2. `tokens.css`에 해당 변수를 `none`으로 선언
3. 쓰는 쪽 CSS에서 `var(--asset-xxx)` 참조
4. 원본 디렉터리가 새로 필요하면 `assets/atlas.config.json`의 `copy`에 등록

## 5. 팔레트 / 폰트

`tokens.css` 상단 `--bg` ~ `--shadow`가 전부다. 32~48색 고정 팔레트가 확정되면 여기만 교체한다.

폰트는 아직 시스템 monospace다(`--font-ui`). 한글 픽셀 비트맵 폰트가 확정되면
`@font-face`를 추가하고 이 토큰만 바꾸면 된다. 라이선스 확인이 선행돼야 한다.

## 6. 스크롤 없는 고정 화면

게임 화면이 스크롤되거나 모바일에서 고무줄처럼 튕기면 안 된다. `base.css`가 이를 차단한다.

- `html, body { overflow: hidden; overscroll-behavior: none; }`
- `#app { position: fixed; inset: 0; height: 100dvh; }`
  — `100vh`가 아니라 `100dvh`인 이유는 모바일 주소창이 접혔다 펴질 때 `100vh`가 실제
  보이는 높이와 어긋나 화면이 잘리기 때문이다
- 확대 방지: viewport 메타의 `user-scalable=no` + `touch-action: manipulation`
- `user-select: none` (입력창만 예외)

**스크롤이 필요한 영역에는 `.scroll-y` 클래스를 붙인다.** 지금은 방 목록만 해당한다.
`overscroll-behavior: contain`이 걸려 있어 목록 끝에서 바깥으로 스크롤이 새지 않는다.

> 새 화면을 만들 때 주의: 바깥은 `overflow: hidden`이라 **넘치는 내용은 스크롤이 아니라
> 잘린다.** 세로가 길어질 수 있는 영역은 `max-height`를 `vh` 기준으로 잡고 `.scroll-y`를
> 붙일 것.

### 검증 결과

여러 뷰포트에서 문서 overflow를 실측했다 (`scrollWidth - clientWidth`, `scrollHeight - clientHeight`).

| 뷰포트 | overflowX | overflowY |
|---|---|---|
| 2560×1440 | 0 | 0 |
| 1920×1080 | 0 | 0 |
| 1280×720 | 0 | 0 |
| 1024×600 | 0 | 0 |
| 800×600 | 0 | 0 |
| 480×900 | 0 | 0 |
| 400×380 | 0 | 0 |

420×400까지도 잘림 없이 들어간다. 화면을 추가하면 이 표를 다시 확인할 것.

## 7. 현재 화면 구성

**컨테이너 패널을 두지 않는다 — 화면 전체가 곧 레이아웃이다.**
(와이어프레임의 바깥 사각형은 화면 경계를 나타낸 구분선이지 UI 요소가 아니다)

| 화면 | 구성 |
|---|---|
| 랜딩 | 로고 슬롯 / 태그라인 / 닉네임 입력 / [참가하기] [방 만들기] / 오프라인 진입(개발용) |
| 방 목록 | 목록(스크롤) / 새로고침 / 방 코드+비밀번호 참가 / 뒤로 |
| 방 만들기 | 방 이름 / 비밀번호 / 만들기 / 뒤로 |
| 접속 중 | 로딩 문구 |

### 랜딩 레이아웃 규칙

`.landing`은 위(`landing-top`) / 가운데(`landing-mid`) / 아래(`landing-bottom`) 세 구역을
`justify-content: space-between`으로 화면 높이에 분배한다. 창 크기가 달라져도 각 요소의
**상대 위치**가 유지된다.

- 로고: `--logo-w: min(620px, 82vw)` + `aspect-ratio` — 화면 폭에 비례해 커진다.
  세로가 짧은 창을 위해 `max-height: 26vh` 상한이 걸려 있다
- 버튼: 좌우 끝(패딩 선)까지 벌어진다. `max-width: 1400px`는 초광폭 모니터에서만 걸린다
- `.landing { max-height: 820px; margin: auto 0; }` — 큰 화면에서 요소끼리 지나치게
  벌어지지 않도록 세로 상한을 두고 가운데 정렬한다

목록·생성 화면은 폼이 가로로 늘어지면 읽기 어려워서 `.screen-form`으로 최대 폭(560px)만
제한하고 가운데 정렬한다. 이때도 감싸는 패널은 없다.
