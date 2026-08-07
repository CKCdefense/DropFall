# 작업 보고서 — GitHub Pages 배포 시 UI 이미지가 전부 404였던 버그

> 배포된 랜딩 페이지의 배경/로고/버튼 이미지가 전부 안 뜨고, 콘솔에
> `/DropFall/assets/assets/ui/btn_stone.png` 같은 **이중 `assets/`** 경로로
> 404가 찍혔다. 원인은 CSS 커스텀 프로퍼티에 담긴 `url()`의 상대경로
> 해석 기준이 "그 값을 설정한 곳"이 아니라 "그 값을 **소비하는
> 스타일시트 자신의 위치**"라는 CSS 스펙의 함정이었다.

---

## 1. 기획 — 무엇을, 왜

원문 제보: 배포된 `https://ckcdefense.github.io/DropFall/`에서 브라우저
콘솔에 `input.png`, `logo_title.png`, `btn_stone.png` 등 여러 UI 이미지의
404 로그가 대량으로 찍혔고("지금 배포된 페이지 렌딩페이지가 안보이는
버그도 확인됐어"), 실제로 랜딩 화면이 배경/로고 없이 깨져 보였다.

## 2. 과정 — 어떻게 했나

### 2.1 증상 — 정확히 두 번 겹친 `assets/`

콘솔 로그의 요청 URL이 전부 `.../DropFall/assets/assets/ui/...` 형태였다
— `assets/`가 정확히 두 번 들어갔다. `packages/client/src/ui/assets.ts`의
`IMAGE_ASSETS`에 등록된 경로(`assets/ui/btn_stone.png` 등)는 한 번만
"assets/"를 갖고 있고, 실제 파일도 `public/assets/ui/*.png`에 정확히
한 겹으로 있었다 — 소스에 이중 경로가 박혀 있는 게 아니었다.

### 2.2 원인 — CSS 커스텀 프로퍼티의 `url()` 재해석

`assets.ts`의 `resolveAssetUrl()`은 `import.meta.env.BASE_URL`(빌드 설정상
`'./'`, 상대경로)을 그대로 이어붙인 **상대** URL(`./assets/ui/btn_stone.png`)을
돌려주고 있었다. 이 값을 `loadImageAssets()`가
`document.documentElement.style.setProperty('--asset-button', "url('...')")`
로 CSS 커스텀 프로퍼티에 넣고, 실제 배경/테두리는 컴파일된 스타일시트
안에서 `var(--asset-button)`로 참조한다.

여기서 CSS 스펙의 잘 알려지지 않은 함정에 걸린다: 커스텀 프로퍼티 값
안의 `url(...)`은 **그 프로퍼티를 설정한 지점**(document)이 아니라
**그 `var()`를 실제로 쓰는 스타일시트 자신의 base URL** 기준으로 다시
해석된다. Vite가 번들 CSS를 `dist/assets/index-[hash].css`처럼
`assets/` 하위에 떨어뜨리므로, 그 스타일시트의 base는
`/DropFall/assets/`다 — 거기에 상대경로 `./assets/ui/btn_stone.png`를
또 이어붙이면 `/DropFall/assets/assets/ui/btn_stone.png`가 된다. 정확히
관측된 이중 경로다.

`characterPortrait.ts`(인라인 `style.backgroundImage` 직접 대입),
`fonts.ts`(`FontFace` 생성자), `playerSprite.ts`/`monsterSprite.ts`
(Phaser 로더 전달)도 같은 `resolveAssetUrl()`을 쓰지만 이쪽은 전부
안전하다 — 인라인 스타일/FontFace/fetch·XHR 기반 로더는 문서(document)
기준으로 해석되지, 외부 스타일시트 기준으로 재해석되지 않는다. **외부
스타일시트가 `var()`로 소비하는 경우만** 이 함정에 걸린다.

### 2.3 수정 — 절대 URL로 통일

`resolveAssetUrl()`이 상대경로 문자열을 그대로 반환하는 대신
`new URL(relative, document.baseURI).href`로 **절대** URL을 만들어
반환하게 바꿨다. 절대 URL은 그 자체로 완결돼 있어 어떤 컨텍스트(인라인
스타일이든 외부 스타일시트든)에서 소비되든 다시 해석될 여지가 없다.
호출부 전부(위 4곳 포함)가 이 함수 하나를 거치므로 수정은 한 곳으로
끝났다.

### 2.4 검증 — 로컬에서 GitHub Pages 하위경로를 그대로 재현

`vite build` 후 `dist/`를 `/DropFall/` 하위경로로 서빙하는 임시 정적
서버를 띄우고(스크래치패드, 커밋 대상 아님) Playwright로 접속해
콘솔을 확인했다 — 수정 전엔 이중 경로 404가 다수, 수정 후엔 무관한
`favicon.ico` 404 하나만 남고 배경/로고/버튼이 전부 정상 렌더링됐다
(스크린샷으로 확인).

## 3. 결과 — 검증

```bash
pnpm --filter @dropfall/client typecheck
pnpm lint
pnpm --filter @dropfall/client build
```

로컬 `/DropFall/` 하위경로 재현 + Playwright 콘솔/스크린샷 확인(위 2.4).

### 2.5 후속 — 이 수정이 드러낸 확인창(`confirmQuit.ts`) 가독성 문제

이 수정으로 `title_modal.png`(9-slice 모달 프레임)가 처음으로 실제
로드되기 시작하자, ESC 나가기 확인창([frontend/11](11-work-report-quit-confirm-modal.md))의
문구가 안 보이는 부작용이 드러났다 — `title_modal.png`는 로비의 큰(760px)
방목록 모달 기준으로 만들어진 에셋인데, 훨씬 작은(360px) 확인창에 그대로
적용되면서 `.modal[data-asset]`이 가정하는 배경/글자색(`#1b1f27`) 조합이
안 맞았다(실제 스크린샷으로 확인). 확인창은 `assetAttr('modal')`을 아예
빼서 항상 플레이스홀더 스타일(어두운 패널 + 얇은 테두리, 기본 글자색)로
고정하도록 고쳤다 — 로컬 `/DropFall/` 하위경로 재현 환경에서 ESC를 눌러
"정말 나가시겠습니까?" 문구가 정상적으로 보이는 것까지 스크린샷으로
확인했다.

## 4. 다음 작업

- 없음. `resolveAssetUrl()`을 거치는 모든 신규 DOM UI 이미지가 앞으로도
  자동으로 이 문제를 피해간다.
