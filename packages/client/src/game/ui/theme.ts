import type Phaser from 'phaser';

/**
 * HUD 공용 스타일 값.
 *
 * HudScene이 아니라 별도 모듈에 두는 이유: 각 UI 컴포넌트가 HudScene에서 상수를
 * 가져오면 HudScene ↔ 컴포넌트 사이에 순환 import가 생긴다. ESM 순환에서는 모듈
 * 평가 순서에 따라 상수가 undefined로 읽힐 수 있어서, 잎사귀 모듈로 분리해 둔다.
 */

/**
 * 갈무리 픽셀 폰트. ui/fonts.ts가 런타임에 등록한다 — 없으면 폴백으로 넘어간다.
 *
 * 픽셀 폰트는 **설계 크기의 정수배에서만 선명하다**. 사이 값을 쓰면 획이 뭉개져서
 * 오히려 기본 폰트보다 못 읽는다. 그래서 크기를 두 종류로 고정하고, 화면이 커질 때는
 * uiScale을 정수(1 또는 2)로만 곱한다(HudScene.layout 참고).
 */
export const FONT = "'Galmuri11', ui-monospace, monospace";
/** 아주 작은 글자용. 11px짜리를 줄이는 대신 7px 전용 폰트를 쓴다. */
export const FONT_SMALL = "'Galmuri7', ui-monospace, monospace";

/** 본문 크기(px). Galmuri11의 설계 크기다. */
export const SIZE_BODY = 11;
/** 작은 글자 크기(px). Galmuri7의 설계 크기다. */
export const SIZE_SMALL = 7;

export const ACCENT = '#6fd08c';
export const DIM_TEXT = '#79828f';
export const BODY_TEXT = '#cfd6e4';
export const DOWN_COLOR = '#d9756b';

/**
 * 탭 페이지 아래에 붙는 **상세 구역**(고른 물건 하나를 설명하는 띠)의 높이 규칙.
 *
 * 예전에는 "남은 높이를 전부 쓴다"였다. 창이 세로로 길어지자 상세가 격자보다 커져서,
 * 정작 고르는 곳(격자)은 좁고 설명 칸만 텅 빈 채 넓어졌다 — 무엇을 하는 창인지가
 * 뒤집힌다. 상세는 **판의 일부**여야 하므로 비율 상한을 두고 잘라낸다.
 * 제작/상점 두 탭이 같은 값을 써야 탭을 오갈 때 아래 띠가 같은 자리에 있다.
 */
export const DETAIL_RATIO = 0.22;
export const DETAIL_MIN_HEIGHT = 96;
export const DETAIL_MAX_HEIGHT = 132;

/** 와이어프레임의 테두리 상자 색. 전 구역이 같은 모양을 쓴다. */
export const PANEL_FILL = 0x14161d;
export const PANEL_STROKE = 0x4a5262;

/** 체력·코어 바 색. 30% 아래로 떨어지면 위험색으로 바꾼다. */
export const BAR_BACK = 0x2b303c;
export const BAR_OK = 0x6fd08c;
export const BAR_DANGER = 0xd9756b;
/** 이 비율 아래면 위험색으로 전환한다. */
export const BAR_DANGER_RATIO = 0.3;

export function barColor(ratio: number): number {
  return ratio > BAR_DANGER_RATIO ? BAR_OK : BAR_DANGER;
}

/**
 * 패널 밖에 떠 있는 글자에 1px 그림자를 넣는다.
 *
 * 바닥이 단색이던 때는 필요 없었는데, 지형 타일을 깔면서 글자가 풀·모래 무늬에 묻히게 됐다.
 * 픽셀 폰트라 외곽선(stroke)을 두르면 획이 번지므로, **흐림 없는 1px 그림자**로 대비만 준다.
 *
 * offset은 UI 배율을 따라간다 — 2배에서 1px 그림자는 너무 얇아 보이지 않는다.
 */
export function applyTextShadow(text: Phaser.GameObjects.Text, scale = 1): void {
  text.setShadow(scale, scale, SHADOW, 0, false, true);
}

/**
 * `Text.setText()`만으로는 안 되는 경우가 있어서 만들었다.
 *
 * 코어 충전 칸이 잠김→열림으로 바뀌는 순간(문자열이 실제로 바뀌는 그 한 번)
 * 텍스트 오브젝트의 `.text` 값은 정확히 갱신되는데(직접 읽어서 확인함) 화면
 * 픽셀은 이전 문자열("잠김")에 멈춰 있는 채로 다시는 안 갱신되는 걸 실측으로
 * 재현했다(Playwright로 직접 클릭·업그레이드를 재현해서 확인) — Phaser
 * Text가 내부적으로 캔버스 텍스처를 다시 굽는 과정이 그 순간에만 씹히면,
 * 그 뒤로는 문자열이 안 바뀌니(같은 값 재대입) 다시 구울 계기도 없다.
 * `updateText()`(Phaser 내부 API, 공개 타입엔 없어서 캐스팅으로 부른다)를
 * 강제로 한 번 더 불러 텍스처를 무조건 다시 굽게 한다 — 매 프레임 불러도
 * 싼 연산이라 조건 분기 없이 그냥 항상 부른다.
 */
export function forceSetText(text: Phaser.GameObjects.Text | undefined, value: string): void {
  if (!text) return;
  text.setText(value);
  (text as unknown as { updateText(): void }).updateText();
}

const SHADOW = '#0B0D12';
