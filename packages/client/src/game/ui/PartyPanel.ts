import Phaser from 'phaser';
import { jobsData } from '@dropfall/shared';
import type { PlayerView } from '../../net/GameConnection';
import { BAR_SMALL, HUD_BAR_SCALE, HudBar } from './hudBar';
import {
  BODY_TEXT,
  DOWN_COLOR,
  FONT,
  PANEL_FILL,
  PANEL_STROKE,
  SIZE_BODY,
  barColor,
} from './theme';

const BOX_WIDTH = 92;
/** 이름 한 줄(11px) + 게이지 16px + 위아래 여백. 게이지가 두꺼워지며 30 → 40이 됐다. */
const BOX_HEIGHT = 40;
const BOX_GAP = 5;
/**
 * 코어·경험치와 같은 얇은 게이지 규격(화면 px).
 * 높이는 그림 × HUD_BAR_SCALE이라 여기서 임의로 못 바꾼다(hudBar 참고).
 */
const BAR_HEIGHT = BAR_SMALL.height * HUD_BAR_SCALE;

/**
 * 화면 좌측 세로 칸 — 팀원 체력(와이어프레임 좌측 3칸).
 *
 * 자기 자신은 여기 나오지 않는다. 내 체력은 퀵슬롯 위에 따로 붙는다 — 협동 게임에서
 * "누가 위험한가"는 남을 보는 정보고, 내 체력은 손이 가는 곳 근처에 있어야 한다.
 * 인원이 모자라면 칸을 통째로 숨긴다.
 */
export class PartyPanel {
  private readonly boxes: Phaser.GameObjects.Rectangle[] = [];
  private readonly nameLabels: Phaser.GameObjects.Text[] = [];
  private readonly bars: HudBar[] = [];
  /** 레이아웃 후 실제 높이(px). */
  height = 0;
  /** 마지막 레이아웃에서 게이지에 적용한 배율. 채움 갱신 때 같은 값을 넘겨야 한다. */
  private barScale = HUD_BAR_SCALE;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly capacity: number,
  ) {
    for (let index = 0; index < capacity; index += 1) {
      this.boxes.push(
        scene.add
          .rectangle(0, 0, BOX_WIDTH, BOX_HEIGHT, PANEL_FILL, 0.82)
          .setOrigin(0, 0)
          .setStrokeStyle(1, PANEL_STROKE),
      );
      this.nameLabels.push(
        scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${SIZE_BODY}px`, color: BODY_TEXT }),
      );
      this.bars.push(new HudBar(scene, BAR_SMALL));
    }
  }

  layout(left: number, top: number, scale: number): void {
    const width = BOX_WIDTH * scale;
    const boxHeight = BOX_HEIGHT * scale;
    const gap = BOX_GAP * scale;
    const barWidth = width - 10 * scale;
    this.height = this.capacity * boxHeight + (this.capacity - 1) * gap;
    this.barScale = scale * HUD_BAR_SCALE;

    for (let index = 0; index < this.capacity; index += 1) {
      const y = top + index * (boxHeight + gap);
      this.boxes[index].setSize(width, boxHeight).setPosition(left, y);
      this.nameLabels[index].setFontSize(SIZE_BODY * scale).setPosition(left + 5 * scale, y + 4 * scale);
      // 칸 아래 테두리에서 5px 띄운 자리. 게이지 높이가 그림에 묶여 있으므로
      // "아래에서부터" 잡아야 칸을 넘지 않는다.
      this.bars[index].layout(
        left + 5 * scale,
        y + boxHeight - (BAR_HEIGHT + 5) * scale,
        barWidth,
        scale * HUD_BAR_SCALE,
      );
    }
  }

  /** 나를 제외한 팀원 목록을 받는다. */
  update(teammates: PlayerView[]): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const player = teammates[index];
      const visible = player !== undefined;

      this.boxes[index].setVisible(visible);
      this.nameLabels[index].setVisible(visible);
      this.bars[index].setVisible(visible);
      if (!player) continue;

      const down = player.hp <= 0;
      this.nameLabels[index].setText(down ? `${player.nickname} 다운` : player.nickname);
      this.nameLabels[index].setColor(down ? DOWN_COLOR : BODY_TEXT);

      // 개발 커맨드(hp)로 최대치를 넘길 수 있어서 위쪽도 조인다(HudScene와 같은 이유).
      const ratio = Math.min(1, Math.max(0, player.hp) / (player.maxHp || jobsData.base.maxHp));
      this.bars[index].setValue(ratio, barColor(ratio), this.barScale);
    }
  }
}
