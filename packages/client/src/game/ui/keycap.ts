import Phaser from 'phaser';
import { HUD_ATLAS } from './hudBar';
import { FONT, PANEL_FILL, PANEL_STROKE, SIZE_BODY } from './theme';

/**
 * 키캡 한 장 — 9-slice 그림(`hud_keycap`) 위에 글자.
 *
 * 가이드 창이 쓰던 그림 어휘를 HUD에서도 그대로 쓴다. `[V]`처럼 대괄호로 감싼 글자는
 * 조작키라는 걸 관습으로만 알려주는데, 같은 자리에 실제 키캡을 놓으면 그림 하나로
 * "이건 누르는 키다"가 끝난다 — 가이드 창에서 본 것과 같은 물건이라 더 그렇다.
 *
 * 그림이 없으면(아틀라스 미빌드) 사각형 + 테두리로 떨어진다 — HUD 조각의 공통 규칙이다.
 *
 * 좌표계는 **왼쪽 위 모서리** 기준이다(HudBar·uiFrame과 같다).
 */

const CAP_FRAME = 'hud_keycap_base_0';
/** 원본 크기와 9-slice 보존 폭. ui_keycap.lua가 그린 값과 같아야 한다. */
const CAP_HEIGHT = 20;
const CAP_BORDER = 7;
/** 원본 기준 글자 좌우 여백과 최소 폭 — 한 글자짜리도 정사각형에 가깝게. */
const CAP_TEXT_PAD = 7;
const CAP_MIN_WIDTH = 22;
/** 아래 4px(원본)은 옆면(두께)이라 글자는 윗면 가운데에 놓는다. */
const CAP_SIDE = 4;
/** 키캡 윗면은 밝아서 글자는 어두운 색이다(가이드 창과 같은 값). */
const CAP_TEXT = '#14161d';

export class Keycap {
  private readonly cap: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly textured: boolean;
  /** 마지막 layout에서 그린 화면 폭. 옆에 글자를 붙일 때 호출부가 쓴다. */
  width = 0;

  constructor(scene: Phaser.Scene, key: string) {
    this.textured =
      scene.textures.exists(HUD_ATLAS) && scene.textures.get(HUD_ATLAS).has(CAP_FRAME);

    this.cap = this.textured
      ? scene.add
          .nineslice(0, 0, HUD_ATLAS, CAP_FRAME, CAP_MIN_WIDTH, CAP_HEIGHT, CAP_BORDER, CAP_BORDER, 0, 0)
          .setOrigin(0, 0)
      : scene.add
          .rectangle(0, 0, CAP_MIN_WIDTH, CAP_HEIGHT, PANEL_FILL, 1)
          .setOrigin(0, 0)
          .setStrokeStyle(1, PANEL_STROKE);
    this.label = scene.add
      .text(0, 0, key, {
        fontFamily: FONT,
        fontSize: `${SIZE_BODY}px`,
        fontStyle: 'bold',
        // 그림이 없으면 어두운 판 위라 밝은 글자여야 읽힌다.
        color: this.textured ? CAP_TEXT : '#e6eaf2',
      })
      .setOrigin(0.5, 0.5);
  }

  /** 이 배율에서 차지하는 높이(화면 px). 세로 배치를 잡는 쪽이 쓴다. */
  heightAt(scale: number): number {
    return CAP_HEIGHT * scale;
  }

  /**
   * @param scale 픽셀아트라 **정수배만** 넘긴다. 글자도 같은 배수로 커진다
   *   (Galmuri11은 11/22/33에서만 선명하다).
   */
  layout(x: number, y: number, scale: number): void {
    const fontSize = SIZE_BODY * scale;
    this.label.setFontSize(fontSize);

    // 9-slice 폭은 **원본 픽셀**로 준다 — 화면 px을 그대로 넣으면 가운데만 늘어나고
    // 모서리 장식은 1px에 머문다(HudBar와 같은 규칙).
    const sourceWidth = Math.max(
      CAP_MIN_WIDTH,
      Math.ceil(this.label.width / scale) + CAP_TEXT_PAD * 2,
    );
    this.width = sourceWidth * scale;

    if (this.textured) {
      const cap = this.cap as Phaser.GameObjects.NineSlice;
      cap.setSize(sourceWidth, CAP_HEIGHT);
      cap.setScale(scale);
      cap.setPosition(x, y);
    } else {
      (this.cap as Phaser.GameObjects.Rectangle).setSize(this.width, CAP_HEIGHT * scale).setPosition(x, y);
    }
    // 글자는 키캡 **윗면**의 가운데다. 아래 옆면까지 세면 한 픽셀 내려앉아 보인다.
    this.label.setPosition(x + this.width / 2, y + ((CAP_HEIGHT - CAP_SIDE) * scale) / 2);
  }

  setVisible(visible: boolean): void {
    this.cap.setVisible(visible);
    this.label.setVisible(visible);
  }

}
