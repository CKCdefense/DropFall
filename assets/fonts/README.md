# 폰트

## 갈무리 (Galmuri)

한글 픽셀 폰트. 게임 UI 전반과 인게임 HUD에 쓴다.

- 저작자: Lee Minseo (quiple@quiple.dev)
- 라이선스: **SIL Open Font License 1.1**
- 배포처: https://github.com/quiple/galmuri

> ⚠️ **OFL은 폰트를 배포할 때 라이선스 전문을 함께 두도록 요구한다.**
> 배포본에 들어 있는 `OFL.txt`를 이 디렉터리에 추가해야 한다. (아직 없음)

## 어떤 파일을 저장소에 두는가

**`.woff2`와 `galmuri.css`만 커밋한다.** `.ttf` / `.ttc` / `.bdf`는 `.gitignore`로 제외했다 —
갈무리 배포본 전체는 100MB가 넘어서 그대로 넣으면 클론이 감당이 안 되고, 한 번 들어간
바이너리는 히스토리에서 지우기도 어렵다. 웹 빌드는 `.woff2`만 쓰므로 실질적인 손해가 없다.

데스크톱 포맷이 필요하면(디자인 툴 등) 위 배포처에서 직접 받는다.

## 빌드에 들어가는 것

`assets/atlas.config.json`의 `include` 목록에 적힌 것만 `public/assets/fonts/`로 복사된다.
지금은 3개다.

| 파일 | 용도 |
|---|---|
| `Galmuri11.woff2` | 본문 (HUD, 로비 UI) |
| `Galmuri11-Bold.woff2` | 강조 |
| `Galmuri7.woff2` | 아주 작은 글자 (월드 닉네임, 칸 번호) |

woff2 원본은 전부 남겨둔다 — 웨이트를 바꾸고 싶으면 `include`만 고치면 되고,
폰트를 다시 받을 필요가 없다.

## 크기 규칙

**픽셀 폰트는 설계 크기의 정수배에서만 선명하다.** Galmuri11은 11/22/33px,
Galmuri7은 7/14/21px이다. 그 사이 값(13px 등)을 쓰면 획이 뭉개져서 오히려 일반 폰트보다
못 읽는다. 그래서 HUD의 UI 배율도 정수로만 떨어지게 해뒀다(`HudScene.layout`).

## 등록 방식

CSS `@font-face`가 아니라 `packages/client/src/ui/fonts.ts`가 런타임에 FontFace API로
등록한다. 폰트가 `public/`에 있어서 Vite가 경로를 재작성해주지 않기 때문이다 —
CSS에 절대경로를 쓰면 GitHub Pages 하위경로에서 깨진다. 이미지 에셋과 같은 문제이고
같은 해법(`resolveAssetUrl`)을 쓴다.
