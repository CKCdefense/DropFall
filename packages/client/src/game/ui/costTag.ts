import Phaser from 'phaser';
import type { PanelBuilder } from './Modal';
import { HUD_ATLAS } from './hudBar';
import { BODY_TEXT, FONT, SIZE_BODY } from './theme';

/**
 * "자원 30" 대신 **[광석 그림] 30**.
 *
 * 값의 단위를 글자 대신 그림으로 말한다. 창마다 "자원", "에너지", "E"로 제각각 부르던
 * 것이 하나로 모이고(같은 그림 = 같은 게이지), 무엇보다 글자가 줄어서 좁은 칸에
 * 숫자가 크게 들어간다 — 상점 진열칸처럼 폭이 정해진 자리에서 특히 그렇다.
 *
 * 그림은 코어 패널 HUD가 쓰는 것과 **같은 아이콘**이다(hud_icon_resource/energy).
 * 화면 왼쪽 위 게이지와 여기 가격표가 같은 그림이라야 "저 게이지에서 나간다"가 읽힌다.
 *
 * 아틀라스가 없으면 그림 없이 숫자만 남는다 — HUD 조각의 공통 규칙이다(hudBar 참고).
 */
export class CostTag {
  private readonly icon: Phaser.GameObjects.Image | null;
  private readonly text: Phaser.GameObjects.Text;
  /** 그림의 화면 크기(px). 원본 12px의 정수배만 쓴다. */
  private readonly iconSize: number;
  private readonly gap: number;

  constructor(
    builder: PanelBuilder,
    frame: string,
    opts: { iconScale?: number; fontSize?: number; gap?: number } = {},
  ) {
    const scene = builder.scene;
    const scale = opts.iconScale ?? 1;
    const fontSize = opts.fontSize ?? SIZE_BODY;
    this.gap = opts.gap ?? 4;

    const texture = scene.textures.exists(HUD_ATLAS) ? scene.textures.get(HUD_ATLAS) : null;
    if (texture?.has(frame)) {
      const source = texture.get(frame);
      this.iconSize = source.height * scale;
      this.icon = scene.add.image(0, 0, HUD_ATLAS, frame).setOrigin(0, 0.5).setScale(scale);
      builder.add(this.icon);
    } else {
      this.icon = null;
      this.iconSize = 0;
    }

    this.text = scene.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: `${fontSize}px`,
        fontStyle: 'bold',
        color: BODY_TEXT,
      })
      .setOrigin(0, 0.5);
    builder.add(this.text);
  }

  setValue(value: string, color: string = BODY_TEXT): void {
    this.text.setText(value).setColor(color);
  }

  setVisible(visible: boolean): void {
    this.icon?.setVisible(visible);
    this.text.setVisible(visible);
  }

  /** 그림 + 숫자를 한 덩어리로 보고 그 폭을 잰다. 자리를 잡은 뒤에 물어야 맞는다. */
  get width(): number {
    return (this.icon ? this.iconSize + this.gap : 0) + Math.ceil(this.text.width);
  }

  /**
   * @param y 세로 **가운데** 좌표. 그림과 글자 높이가 달라서 위쪽 기준으로 맞추면 어긋난다.
   * @param align 0이면 x가 왼쪽 끝, 1이면 오른쪽 끝, 0.5면 x를 가운데로 본다.
   */
  place(x: number, y: number, align = 0): void {
    const left = x - this.width * align;
    const textX = this.icon ? left + this.iconSize + this.gap : left;
    this.icon?.setPosition(left, y);
    this.text.setPosition(textX, y);
  }
}
