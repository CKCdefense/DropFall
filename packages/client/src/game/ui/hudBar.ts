import Phaser from 'phaser';
import { resolveAssetUrl } from '../../ui/assets';
import { BAR_BACK } from './theme';

/**
 * HUD 게이지(체력·스태미나·경험치·코어·보스)의 픽셀아트 껍데기.
 *
 * 원본은 `assets/_generators/ui_hud.lua`가 만들고 `ui` 아틀라스로 구워진다.
 * 구조는 두 겹이다 — **틀(9-slice)** 위에 **채움(가로로 늘어나는 스프라이트)**.
 *
 * 채움 그림은 **흰색 세로 그라데이션**이다. 색은 setTint로 입힌다 — 곱셈이라 위쪽
 * 하이라이트와 아래쪽 그늘이 그대로 살아서, 색만 바꿔도(barColor) 입체감이 유지된다.
 * 색깔별로 그림을 따로 그릴 필요가 없다.
 *
 * **에셋이 없어도 HUD는 떠야 한다** — uiFrame.ts와 같은 규칙이다. 아틀라스가 안 올라오면
 * 예전처럼 단색 사각형 두 장으로 떨어진다(호출부는 둘을 구분하지 않는다).
 */

export const HUD_ATLAS = 'ui';

/**
 * 게이지를 UI 배율에 한 번 더 곱해 키우는 배수.
 *
 * 예전엔 1배로 그렸다 — 그러면 **아트 1픽셀 = 화면 1픽셀**이라 외곽선·안쪽 홈·베벨이
 * 전부 1px이 되어 눈에 안 들어왔다. 월드는 카메라 줌 2~4배로 그려지므로 캐릭터·몬스터
 * 픽셀은 굵은데 HUD만 곱게 나와서, 같은 화면인데 픽셀아트로 안 읽혔다.
 *
 * 정수배만 쓴다 — 1.5배로 늘리면 픽셀 경계가 반 픽셀에 걸려 뭉개진다.
 * 그림 원본은 이 배수를 감안해 **작게** 그려 둔다(BAR_LARGE.height = 16 → 화면 32px).
 */
export const HUD_BAR_SCALE = 2;

/**
 * 아틀라스 로드를 예약한다. **GameScene.preload에서 부른다** — HudScene에는 preload가
 * 없고, 텍스처는 게임 전체가 공유하므로 여기서 한 번 올리면 나중에 뜨는 HudScene도 쓴다.
 */
export function queueHudAtlas(scene: Phaser.Scene): void {
  scene.load.atlas(
    HUD_ATLAS,
    resolveAssetUrl('assets/atlas/ui.png'),
    resolveAssetUrl('assets/atlas/ui.json'),
  );
}

/**
 * 게이지 규격. **높이는 그림에 박혀 있어서 코드가 마음대로 못 정한다** — 늘리면 픽셀이
 * 뭉개진다. 그래서 각 규격이 자기 높이를 들고 있고, 호출부는 이 값을 레이아웃에 쓴다.
 *
 * - `insetX/insetY` 틀 안쪽에서 채움이 시작하는 자리. boss는 양끝 강철 캡(4px+경계선)
 *   때문에 가로 여백이 더 크다.
 * - `border` 9-slice에서 **늘이지 않고 보존할** 좌우 폭. 모서리 장식이 여기 들어간다.
 */
export interface BarStyle {
  readonly back: string;
  readonly fill: string;
  readonly height: number;
  readonly insetX: number;
  readonly insetY: number;
  readonly border: number;
}

/**
 * 내 체력·스태미나처럼 두껍게 보여주는 주력 게이지.
 * height는 **원본 픽셀**이다 — 화면에는 HUD_BAR_SCALE이 곱해져 32px로 나온다.
 */
export const BAR_LARGE: BarStyle = {
  back: 'hud_bar_back_l_base_0',
  fill: 'hud_bar_fill_l_base_0',
  height: 16,
  insetX: 2,
  insetY: 2,
  border: 3,
};

/** 코어·경험치·팀원처럼 곁눈질용으로 얇게 까는 게이지(화면에서는 16px). */
export const BAR_SMALL: BarStyle = {
  back: 'hud_bar_back_s_base_0',
  fill: 'hud_bar_fill_s_base_0',
  height: 8,
  insetX: 2,
  insetY: 2,
  border: 3,
};

/**
 * 보스전 전용. 양끝에 8px 강철 브래킷(리벳 + 크림슨 젬)이 붙어 있어 보존 폭(border)이
 * 훨씬 크다 — 이 값이 작으면 브래킷이 늘어나서 뭉개진다.
 * 숫자는 `assets/_generators/ui_hud.lua`의 barBackBoss와 **한 쌍**이다.
 */
export const BAR_BOSS: BarStyle = {
  back: 'hud_bar_back_boss_base_0',
  fill: 'hud_bar_fill_boss_base_0',
  height: 20,
  insetX: 10,
  insetY: 2,
  border: 10,
};

function hasFrames(scene: Phaser.Scene, style: BarStyle): boolean {
  if (!scene.textures.exists(HUD_ATLAS)) return false;
  const texture = scene.textures.get(HUD_ATLAS);
  return texture.has(style.back) && texture.has(style.fill);
}

/**
 * 게이지 하나. 좌표계는 **좌상단 기준**이다 — 다른 HUD 조각과 맞춰야 배치 계산이
 * 한 종류로 끝난다(uiFrame.sliced와 같은 이유).
 *
 * 만드는 순서가 곧 그리는 순서다. 게이지 위에 글자를 얹으려면 **글자를 나중에** 만든다.
 */
export class HudBar {
  private readonly back: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  private readonly fill: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  private readonly textured: boolean;

  /** 채움이 쓸 수 있는 최대 폭(px). 비율을 여기에 곱한다. */
  private trackWidth = 0;
  private ratio = 1;
  private color = 0xffffff;
  /**
   * 호출부가 요청한 표시 여부. 채움은 "값이 0이면 숨긴다"는 규칙이 따로 있어서,
   * 레이아웃할 때마다 다시 계산한다 — 이 값을 안 들고 있으면 숨겨 둔 보스 바가
   * 창 크기만 바뀌어도 되살아난다.
   */
  private visible = true;

  constructor(
    scene: Phaser.Scene,
    private readonly style: BarStyle,
  ) {
    this.textured = hasFrames(scene, style);

    if (this.textured) {
      this.back = scene.add
        .nineslice(0, 0, HUD_ATLAS, style.back, 10, style.height, style.border, style.border, 0, 0)
        .setOrigin(0, 0);
      this.fill = scene.add.sprite(0, 0, HUD_ATLAS, style.fill).setOrigin(0, 0);
    } else {
      this.back = scene.add.rectangle(0, 0, 10, style.height, BAR_BACK).setOrigin(0, 0);
      this.fill = scene.add.rectangle(0, 0, 10, style.height, 0xffffff).setOrigin(0, 0);
    }
  }

  /** 이 규격이 차지하는 높이(px). 호출부가 세로 배치를 잡을 때 쓴다. */
  heightAt(scale: number): number {
    return this.style.height * scale;
  }

  /** @param scale UI 배율(1 또는 2). 픽셀아트라 정수배만 들어온다. */
  layout(x: number, y: number, width: number, scale: number): void {
    const height = this.style.height * scale;

    if (this.textured) {
      // 9-slice의 폭·높이는 **원본 픽셀 단위**로 주고 배율은 setScale로 따로 건다.
      // 화면 픽셀을 그대로 넣으면 늘어나는 가운데만 커지고 모서리 장식은 1px에
      // 머물러서, uiScale 2배에서 테두리만 홀쭉해진다.
      const sourceWidth = Math.max(this.style.border * 2 + 1, Math.round(width / scale));
      const back = this.back as Phaser.GameObjects.NineSlice;
      back.setSize(sourceWidth, this.style.height);
      back.setScale(scale);
      back.setPosition(x, y);

      const fill = this.fill as Phaser.GameObjects.Sprite;
      fill.setPosition(x + this.style.insetX * scale, y + this.style.insetY * scale);
      this.trackWidth = sourceWidth * scale - this.style.insetX * 2 * scale;
    } else {
      (this.back as Phaser.GameObjects.Rectangle).setSize(width, height).setPosition(x, y);
      (this.fill as Phaser.GameObjects.Rectangle).setPosition(x, y);
      this.trackWidth = width;
    }

    this.apply(scale);
  }

  /**
   * @param ratio 0~1. 호출부가 미리 조여서 넘긴다(개발 커맨드로 최대치를 넘길 수 있다).
   * @param color 채움 색. 흰 그림에 곱해지므로 음영이 유지된다.
   */
  setValue(ratio: number, color: number, scale: number): void {
    this.ratio = Math.min(1, Math.max(0, ratio));
    this.color = color;
    this.apply(scale);
  }

  private apply(scale: number): void {
    // 반 픽셀에 걸치면 픽셀아트가 흐려진다 — 채움 폭은 항상 정수로 자른다.
    const width = Math.round(this.trackWidth * this.ratio);
    const showFill = this.visible && width > 0;

    if (this.textured) {
      const fill = this.fill as Phaser.GameObjects.Sprite;
      // 채움 그림은 세로 그라데이션이라 **모든 열이 같다** — 가로로 늘여도 무늬가
      // 깨지지 않는다. 세로는 원본 높이 × 배율이라 항상 정수배다.
      fill.setDisplaySize(width, (this.style.height - this.style.insetY * 2) * scale);
      fill.setTint(this.color);
      fill.setVisible(showFill);
    } else {
      const fill = this.fill as Phaser.GameObjects.Rectangle;
      fill.setSize(width, this.style.height * scale);
      fill.fillColor = this.color;
      fill.setVisible(showFill);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.back.setVisible(visible);
    // 채움은 값이 0이면 원래 숨어 있다 — 켤 때 그 상태를 되살린다.
    this.fill.setVisible(visible && this.ratio > 0);
  }
}

/**
 * HUD 라벨용 미니 아이콘(하트·번개·해골·코어). 아틀라스가 없으면 아무것도 만들지 않고
 * null을 돌려준다 — 호출부는 옵셔널 체이닝으로 넘긴다.
 */
export function hudIcon(scene: Phaser.Scene, frame: string): Phaser.GameObjects.Image | null {
  if (!scene.textures.exists(HUD_ATLAS) || !scene.textures.get(HUD_ATLAS).has(frame)) return null;
  return scene.add.image(0, 0, HUD_ATLAS, frame).setOrigin(0, 0.5);
}

export const ICON_HEART = 'hud_icon_heart_base_0';
export const ICON_BOLT = 'hud_icon_bolt_base_0';
export const ICON_SKULL = 'hud_icon_skull_base_0';
export const ICON_SKULL_LARGE = 'hud_icon_skull_l_base_0';
/** 코어 패널 게이지 세 줄의 표식 — 코어(원) / 자원(네모) / 에너지(마름모). */
export const ICON_ORB = 'hud_icon_orb_base_0';
export const ICON_RESOURCE = 'hud_icon_resource_base_0';
export const ICON_ENERGY = 'hud_icon_energy_base_0';
/** 낮 스킵 투표 칸. 빈 홈 / 초록 체크 두 장을 바꿔 끼워 상태를 보여준다. */
export const ICON_CHECK_OFF = 'hud_icon_check_off_base_0';
export const ICON_CHECK_ON = 'hud_icon_check_on_base_0';
