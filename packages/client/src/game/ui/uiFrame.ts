import Phaser from 'phaser';
import { resolveAssetUrl } from '../../ui/assets';
import { PANEL_FILL, PANEL_STROKE } from './theme';

/**
 * 인게임 UI의 돌 프레임(9-slice).
 *
 * 로비(DOM)가 이미 같은 그림을 `border-image`로 쓰고 있다 — 같은 파일을 Phaser 텍스처로
 * 한 번 더 올려서 **인게임 모달과 로비 모달이 같은 테두리**를 갖게 한다. 슬라이스 값도
 * 로비 쪽에서 이미 실측해 둔 것(`src/ui/styles/tokens.css`)을 그대로 쓴다 — 두 곳에서
 * 따로 재면 반드시 어긋난다.
 *
 * **에셋이 없어도 UI는 떠야 한다.** 파일이 없으면 조용히 넘어가고, 프레임 대신 예전처럼
 * 단색 사각형 + 1px 테두리로 그린다(§frame). 임시 에셋을 끼워 쓰는 단계라 언제든
 * 빠질 수 있다.
 */

export const UI_FRAME_TEXTURE = 'ui_frame_modal';
export const UI_BUTTON_TEXTURE = 'ui_frame_button';
export const UI_BUTTON_HOVER_TEXTURE = 'ui_frame_button_hover';

/**
 * title_modal.png 원본 64×64, 테두리 약 15px (tokens.css `--asset-modal-slice`).
 * 9-slice에서 이 값이 곧 화면에 그려지는 테두리 두께이자, **내용이 침범하면 안 되는
 * 안쪽 여백**이다 — 모달의 패딩이 이보다 작으면 글자가 돌 테두리 위에 얹힌다.
 */
export const FRAME_INSET = 16;
const FRAME_SLICE = FRAME_INSET;
/** btn_stone.png 원본 64×64, 바깥 2px 투명 + 돌 테두리 7px (tokens.css `--asset-button-slice`). */
const BUTTON_SLICE = 9;

/**
 * 프레임 텍스처 로드를 예약한다. GameScene.preload에서 부른다 — 텍스처는 게임 전체가
 * 공유하므로 나중에 뜨는 HudScene에서도 그대로 쓸 수 있다.
 */
export function queueUiFrames(scene: Phaser.Scene): void {
  scene.load.image(UI_FRAME_TEXTURE, resolveAssetUrl('assets/ui/title_modal.png'));
  scene.load.image(UI_BUTTON_TEXTURE, resolveAssetUrl('assets/ui/btn_stone.png'));
  scene.load.image(UI_BUTTON_HOVER_TEXTURE, resolveAssetUrl('assets/ui/btn_stone_hover.png'));
}

function hasTexture(scene: Phaser.Scene, key: string): boolean {
  return scene.textures.exists(key);
}

/**
 * 9-slice 프레임 하나. 에셋이 없으면 같은 자리·같은 크기의 사각형을 돌려준다 —
 * 호출부는 둘을 구분하지 않고 위치·크기만 다루면 된다.
 */
function sliced(
  scene: Phaser.Scene,
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  slice: number,
  fallbackAlpha: number,
): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle {
  if (!hasTexture(scene, key)) {
    return scene.add
      .rectangle(x, y, width, height, PANEL_FILL, fallbackAlpha)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_STROKE);
  }
  // NineSlice는 원점이 가운데라 좌상단 기준으로 맞춰 준다 — 다른 UI 조각과 좌표계를
  // 통일해야 배치 계산이 한 종류로 끝난다.
  return scene.add
    .nineslice(x, y, key, undefined, width, height, slice, slice, slice, slice)
    .setOrigin(0, 0);
}

/** 모달 바깥 테두리. */
export function frameBox(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle {
  return sliced(scene, UI_FRAME_TEXTURE, x, y, width, height, FRAME_SLICE, 0.95);
}

/** 버튼·탭 배경. hover 상태는 텍스처를 갈아 끼운다. */
export function buttonBox(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle {
  return sliced(scene, UI_BUTTON_TEXTURE, x, y, width, height, BUTTON_SLICE, 0.9);
}

/**
 * 버튼의 눌림/호버 표현. 9-slice면 텍스처를 바꾸고, 플레이스홀더 사각형이면 테두리 색을
 * 바꾼다 — 어느 쪽이든 "지금 이걸 가리키고 있다"가 보이게 한다.
 */
export function setButtonHighlighted(
  box: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle,
  highlighted: boolean,
  accentStroke: number,
): void {
  if (box instanceof Phaser.GameObjects.NineSlice) {
    const key = highlighted ? UI_BUTTON_HOVER_TEXTURE : UI_BUTTON_TEXTURE;
    if (box.scene.textures.exists(key)) box.setTexture(key);
    return;
  }
  box.setStrokeStyle(1, highlighted ? accentStroke : PANEL_STROKE);
}
