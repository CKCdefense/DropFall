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
